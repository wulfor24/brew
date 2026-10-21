"""Render Brew's UI sounds (cues.json) with earshot into public/sfx/<cue>.mp3.

Run through tools/sfx/build.sh, which points at an earshot venv. Each layer is rendered with `earshot sfx render`,
layered at its offset, its silent tail trimmed with a short fade, then set to the cue's level: loudness (LUFS) as a
phone or laptop speaker plays it (nothing much under ~350 Hz or over ~9 kHz), so the cues sound even next to each
other and a cue that mostly lives where a small speaker can't play it fails the build. Audited with `earshot sfx check`,
then encoded to mono 96 kbps mp3 (plays everywhere, iOS Safari included).
"""
import json, os, subprocess, sys, tempfile
import numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy.signal import butter, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'sfx')
EARSHOT = os.environ.get('EARSHOT', 'earshot')
SR = 44100
METER = pyln.Meter(SR, block_size=0.1)
SPEAKER = np.vstack([butter(4, 350, 'hp', fs=SR, output='sos'), butter(4, 9000, 'lp', fs=SR, output='sos')])
CEIL = 10 ** (-1 / 20)  # sample peak at most -1 dBFS
MAX_LOSS = 6  # dB a cue may lose through a small speaker before it counts as muffled


def lufs(y):  # short cues are padded so the meter has a full block
    return METER.integrated_loudness(np.concatenate([y, np.zeros(int(SR * .5))]))


def render(sid, opts, tmp, n):
    p = os.path.join(tmp, f'l{n}.wav')
    cmd = [EARSHOT, 'sfx', 'render', sid, '-o', p, '--sr', str(SR)]
    for k in ('dur', 'apex', 'pitch', 'seed'):
        if k in opts: cmd += [f'--{k}', str(opts[k])]
    subprocess.run(cmd, check=True, capture_output=True)
    y, _ = sf.read(p, always_2d=True)
    return y.mean(axis=1) * opts.get('weight', 1.0)


def build(name, cue, tmp):
    parts = []
    for n, layer in enumerate(cue['layers']):
        sid, at, opts = layer[0], layer[1], (layer[2] if len(layer) > 2 else {})
        parts.append((int(SR * at / 1000), render(sid, opts, tmp, n)))
    y = np.zeros(max(o + len(p) for o, p in parts))
    for o, p in parts: y[o:o + len(p)] += p
    # trim the tail below -60 dB, with a 15 ms fade so nothing clicks
    above = np.nonzero(np.abs(y) > np.abs(y).max() * 10 ** (-60 / 20))[0]
    y = y[:min(len(y), above[-1] + int(SR * .02))]
    f = min(len(y), int(SR * .015)); y[-f:] *= np.linspace(1, 0, f)
    y /= np.abs(y).max(); loss = lufs(y) - lufs(sosfilt(SPEAKER, y))
    for _ in range(4):  # the meter's -70 LUFS gate moves with the level, so settle it in a few passes
        y *= min(10 ** ((cue['level'] - lufs(sosfilt(SPEAKER, y))) / 20), CEIL / np.abs(y).max())
    wav = os.path.join(tmp, f'{name}.wav'); sf.write(wav, y, SR, subtype='PCM_24')
    chk = subprocess.run([EARSHOT, 'sfx', 'check', wav, '--json'], capture_output=True, text=True)
    mp3 = os.path.join(OUT, f'{name}.mp3')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-ac', '1', '-ar', str(SR), '-b:a', '96k', mp3], check=True)
    return len(y) / SR, os.path.getsize(mp3), chk, loss, lufs(sosfilt(SPEAKER, y))


def main():
    cues = json.load(open(os.path.join(HERE, 'cues.json')))['cues']
    only = set(sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    total, bad = 0, []
    with tempfile.TemporaryDirectory() as tmp:
        for name, cue in cues.items():
            if only and name not in only: continue
            dur, size, chk, loss, heard = build(name, cue, tmp)
            total += size
            try:
                r = json.loads(chk.stdout)
                faults = [] if r.get('ok') else [str(w) for w in r.get('warnings') or []] or [r.get('summary', 'not clean')]
            except Exception:
                faults = [chk.stderr.strip()[:120] or 'check failed']
            if loss > MAX_LOSS: faults.append(f'muffled: loses {loss:.0f} dB through a small speaker')
            if heard < cue['level'] - 1.5: faults.append(f'only {heard:.0f} LUFS at the peak ceiling')
            if faults: bad.append((name, faults))
            print(f'{name:10s} {dur:5.2f}s {size / 1024:5.1f} KB {heard:6.1f} LUFS  {"ok" if not faults else "FAULT " + ", ".join(faults)}')
    print(f'total {total / 1024:.1f} KB')
    if total > 200 * 1024: sys.exit('kit is over the 200 KB budget')
    if bad: sys.exit(f'{len(bad)} cue(s) failed the earshot check')


if __name__ == '__main__':
    main()
