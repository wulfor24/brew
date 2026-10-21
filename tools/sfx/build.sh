#!/usr/bin/env bash
# Re-render Brew's UI sounds into public/sfx from tools/sfx/cues.json with earshot (github.com/Leonxlnx/earshot).
# One-time setup (no torch needed: sfx render/check load no models):
#   uv venv --python 3.12 ~/tools/earshot-venv && curl -sL https://codeload.github.com/Leonxlnx/earshot/tar.gz/refs/heads/main | tar xz -C ~/tools
#   uv pip install --python ~/tools/earshot-venv/bin/python numpy scipy soundfile soxr librosa pyloudnorm scikit-learn pillow matplotlib
#   uv pip install --python ~/tools/earshot-venv/bin/python --no-deps -e ~/tools/earshot-main
# Usage: EARSHOT_VENV=~/tools/earshot-venv tools/sfx/build.sh [cue ...]
set -euo pipefail
VENV="${EARSHOT_VENV:-$(cd "$(dirname "$0")/../../.." && pwd)/_tools/.venv}" # set up on Param's Mac at ~/Documents/ChatGPT/_tools
EARSHOT="$VENV/bin/earshot" exec "$VENV/bin/python" "$(dirname "$0")/build.py" "$@"
