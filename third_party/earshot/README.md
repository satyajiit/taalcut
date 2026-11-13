# earshot data

Upstream: <https://github.com/Leonxlnx/earshot>, earshot 0.4.0 at commit
`ff41f0788ae56896fd59879ab03858d223c06a53` (main on 2026-11-06, "cli: hold numpy / scipy's OpenBLAS to
EARSHOT_THREADS"). MIT licence, copyright (c) 2026 Leon Lin (`LICENSE`).

## Why it is here

EAR1 ports earshot's listening layer to TypeScript inside `@taalcut/audio` (`plan/earshot-round-1.md`): no Python
runs in the app. The port needs earshot's measured data as it is, because the numbers it calibrates against were
fitted by upstream and cannot be re-derived without its private reference recordings. Upstream earshot itself runs
only at build and dev time (`tools/earshot-parity`, `tools/audio-packs/sfx-bank`).

## What is vendored (all unchanged)

| File | Upstream path | What it is |
| --- | --- | --- |
| `data/vocab.json` | `earshot/data/vocab.json` | The listening vocabulary: 5 prompt templates and 322 terms in 16 categories |
| `data/vocab_stats.json` | `earshot/data/vocab_stats.json` | Calibration statistics: the 512-long reference mean `mean` (m in u = cos(a, q) − m·q), `logit_scale`, the pad mode and templates; `term_cos` is for inspection only |
| `data/launch_profile.json` | `earshot/data/launch_profile.json` | The critique's reference profile (7 launch films: metric ranges, chance, arc) |
| `data/realness_model.json` | `earshot/data/realness_model.json` | The realness model: standardised logistic heads (CLAP, signal), fusion, thresholds, prompts |
| `kits/{calm,crisp,minimal,launch}.json` | `earshot/forge/kits/*.json` | The four kit presets (kit schema 1) |
| `docs/CREDITS_FIT.md` | `docs/CREDITS_FIT.md` | Credits of the 15 fitted bank sounds (CC0 recordings, fitted as code), for the SFX bank's credits (D22) |

The sha256 of every file is in `package.json` (`upstream.files`); `test/data.test.mjs` checks them, and that the
vocabulary has 322 terms and the reference mean 512 values. `vocab_stats.json` records that upstream built its
statistics with bf16 CLAP weights (`"precision": "bf16"`); the parity fixtures are made with fp32
(`tools/earshot-parity`). No file carries AudioSet ontology content: the vocabulary terms are earshot's own
descriptions.

`NOTICE` is new. Besides earshot's MIT licence it names the licences of what `@taalcut/audio` ships next to this
data: the CLAP model (Apache-2.0), the AST model (BSD-3-Clause) and the AudioSet class label names (CC BY 4.0).

## Use

```ts
import vocab from '@taalcut-vendor/earshot-data/vocab.json' with { type: 'json' };
import stats from '@taalcut-vendor/earshot-data/vocab_stats.json' with { type: 'json' };
```

This is a workspace package (`pnpm-workspace.yaml`, `third_party/*`), linked, never copied. To move to a new
upstream commit: copy the files again, update the sha256 list in `package.json` and the commit here, and rebuild the
parity fixtures (`tools/earshot-parity/README.md`).
