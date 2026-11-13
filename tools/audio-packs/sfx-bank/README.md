# The SFX bank (`sfx-bank`, EAR1-D1)

earshot's bank of 252 sound effects (https://github.com/Leonxlnx/earshot, MIT, pinned at
`ff41f0788ae56896fd59879ab03858d223c06a53`) rendered into takes for Taalcut's `sfx-bank` component. The app never
runs Python: the renders are made here, at build time, and shipped as FLAC with a catalogue
(`packages/audio/src/sfx/bank-catalogue.ts` reads it).

```sh
node tools/audio-packs/sfx-bank/build-sfx-bank.mjs --render --embed
```

| File                 | What it does                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render_bank.py`     | In upstream's venv (`~/.cache/taalcut-ear1/venv`, see tools/earshot-parity/README.md): every sound's takes (its own seed and the next, `--takes 2`) and every take the four presets plan, through `kit.render_take` |
| `embed-bank.mjs`     | CLAP audio embeddings per item with the package's own runner (`packages/audio/src/sfx/bank-embed-cli.ts`, tsx, CPU), int8 and fp16                                                                                  |
| `catalogue.mjs`      | `catalogue.json` from the render: one item per sound, its clean takes, measured and audited; refuses any item without a licence and a source                                                                        |
| `families.mjs`       | Taalcut ids, the four families, licences, credits and provenance by bank file                                                                                                                                       |
| `notice.mjs`         | The archive's `NOTICE.txt`                                                                                                                                                                                          |
| `build-sfx-bank.mjs` | The stages above, FLAC with the bundled FFmpeg (bit-exact), the archive (`../pack-archive.mjs`)                                                                                                                     |

- **Takes.** A take that fails earshot's model-free audit (`sfx check`, with its category, and a preset take with
  its role) is rendered again on seed + 1000 j, up to three times, as `kit render` does. Only clean takes ship. A
  sound with no clean take is withheld and listed in the catalogue's `withheld` (earshot's rising zips and sweeps,
  a rising bubble, a truncated detent: sounds its own presets never use).
- **Samples.** 48 kHz, 16-bit, or 24-bit where rounding to 16 bits would change the audit (a slow sub's peak becomes
  a "flat top"). Each file has 50 ms of digital silence before and after the sound: a hit's clip starts and ends on
  frames, and the pad keeps an attack or a final peak within a frame of the file's ends whole. Times in the
  catalogue are from the sound's start.
- **Measured.** Per take: onset, earshot's loudest 5 ms (`peakMs`, its 1 ms grid) and the apex (`apexMs`, the same
  window at every sample: what the planner puts on a cut), end, sample peak, momentary-max loudness, the audit.
- **Families** (core's `SFX_CATEGORIES`): whoosh (the passes and the tonal sweeps across a cut), riser (builds and
  reverse swells into a cut), impact (hits, drops, downlifters, stings, glitches), hit (every short touch, tick, pop,
  key, bell and note); a fitted sound by its role (`whoosh.*` a whoosh, the rest hits). `families.mjs` has the list.
- **Licences (D22).** Every sound is made by earshot's code, so every render is MIT, earshot's licence, and the
  window shows each as "Code-made". That includes the 15 fitted sounds: earshot renders them
  (`earshot.forge.fit.render`) from the models in `earshot/forge/bank/fit.json` (MIT), which hold the modes,
  partials and band envelopes it measured from CC0 1.0 recordings on Freesound, not their samples. Their
  `sourceUrl` is fit.json at the pinned commit; the recording and its recordist are a credit (`credit`,
  `NOTICE.txt`, `CREDITS_FIT.md`), never the sound's licence, and a fit whose recording isn't CC0 is refused. The
  forge04 members were tuned toward aggregate measurements of private licensed clips; no audio was used. The
  archive carries earshot's `LICENSE-earshot.txt`, `CREDITS_FIT.md` and `NOTICE.txt`.
- **Reproducible.** The same machine and venv render the same samples; embeddings run on the CPU provider; FLAC is
  bit-exact and the archive is written by `pack-archive.mjs`. Two builds give the same sha256, which
  `tools/components/manifest.sfx-bank.provisional.json` records. Change anything that changes the bytes: bump
  `SFX_BANK_VERSION`, rebuild, update the manifest (and `hosting/plan/sfx-bank.mjs`'s file name).
