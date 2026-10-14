# Brew prototype

Brew is a realistic prototype: read → moves → feed → jam → share the brief. Read `SCOPE.md` before adding anything: Do it now,
measurement, Brew sending and real connectors were cut on purpose. Anything simulated is marked Dummy in the UI, with a
`DUMMY:` comment in the code and a row in `DUMMY.md`. Keep all three in step when you add or remove a dummy.

Before changing anything that reads outside data, load the `brew-external-data` skill and follow it. That covers
treg, the Meta Ad Library, rivals, SERP, Instagram, Amazon, web search, a reader stage, a connector, a watcher, a
findings card, a check-page field or the brand profile.
The short version:

- An error is never shown as "none" / "not found": keep `error` on the item and say the check didn't go through.
- Paid sources fall back to free ones (Ad Library: `adCall` in reader/adlib.js), and every treg call goes through the
  shared client in treg.js (24-hour cache). Never call treg directly.
- Saved reads heal themselves (`heal()`); bump the stage version when a stage starts reading differently.
- Brand-agnostic: never fix one brand; audit every brand with `.claude/skills/brew-external-data/audit.py`.
- Run `AI_MOCK=1 node --test test/*.test.js`, boot the server locally, then deploy with `./deploy.sh` (it refuses uncommitted
  code and failing tests).
