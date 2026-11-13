# earshot parity fixtures (EAR1-F2)

Ground truth for `@taalcut/audio`'s TypeScript port of [earshot](https://github.com/Leonxlnx/earshot)'s listening
layer: what upstream earshot 0.4.0 at commit `ff41f0788ae56896fd59879ab03858d223c06a53` says about a fixed,
deterministic clip set, with the model and DSP intermediates behind it. Every later EAR1 lane (model runner,
calibration, DSP, critique, realness, kits) tests against these files.

Python is a build-time tool here only. Tests never run it: they read the committed JSON and float32 files and
regenerate the clips in Node.

## Use from a test

```ts
import {
  blob,
  blobRows,
  cli,
  cliRun,
  clips,
  intermediate,
  kit,
  loadClip,
  manifest,
} from '../../../../tools/earshot-parity/fixtures.mjs';

const clip = loadClip('music-120-fmaj'); // { sampleRate: 48000, channels: Float32Array[], truth }
const described = cliRun('describe', 'music-120-fmaj');
const vocab = blobRows('clap-text/vocab'); // 322 rows of 512, in intermediate('text').vocab.terms order
const windows = blob('clap-audio-windows/film-00'); // { data, shape: [6, 512] }
const film = cliRun('timeline', 'film-00').sync.cuts.items;
```

`fixtures.mjs` (types in `fixtures.d.mts`) checks every file it reads against the sha256 in `fixtures/manifest.json`
and regenerates a generated clip in memory, failing if it differs from the bytes upstream analysed. It needs no
FFmpeg; `writeClip(id, dir)` writes a clip's WAV for FFmpeg-based tests and `writeFilmVideo(id, dir, ffmpeg)` encodes a
film's picture. Relative imports of `tools/` from a package's tests pass dependency-cruiser (its layering rules cover
`packages/` and `apps/` only) and `tsc` (the `.d.mts` types the `.mjs`).

| Function                                    | Returns                                                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest()`                                | The manifest: `clips`, `files` (sha256, bytes), `upstream`, `models` (revision, weights sha256, precision), `versions`, `settings`, `queries`, `borderline` |
| `clips(category?)`, `clip(id)`              | Clip rows: id, category, params, planted `truth`, sha256, samples                                                                                           |
| `loadClip(id)`                              | Planar float32 samples as upstream decoded them                                                                                                             |
| `mono(c)`, `ffmpegMono(c)`                  | earshot's two downmixes of a stereo clip (see below)                                                                                                        |
| `cli(command)`, `cliRun(command, runId)`    | `{ runId: { argv, exit, result } }` from `fixtures/cli/<command>.json`                                                                                      |
| `intermediate(name)`                        | `fixtures/intermediates/<name>.json`                                                                                                                        |
| `blob(key)`, `blobRows(key)`, `blobIndex()` | float32 arrays by `group/key`                                                                                                                               |
| `kit(preset)`                               | `{ kit, lock }`: `kit.json` (kit init) and `kit.lock.json` (kit render)                                                                                     |

## The clips

52 clips, all made here or by upstream's own MIT sound bank; no recording and no text-to-speech output:

| Category     | Clips | How                                                                                                                                                                    |
| ------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| music        | 12    | Drum patterns at 80-170 BPM over chord progressions in 12 known keys (`gen/music.mjs`); truth: tempo, key, beats, downbeats, chords                                    |
| sfx          | 14    | `earshot sfx render <sound>` (its own seed and length), downmixed to mono and rounded to 16-bit, committed in `fixtures/clips/sfx`                                     |
| speech       | 6     | Formant synthesis: Rosenberg glottal pulses through three gliding vowel formants, fricatives, phrases (`gen/voice.mjs`)                                                |
| edge         | 7     | Near-silent (−76 dBFS), digital silence, a 1 kHz pure tone, a hard-clipped loop, +0.25 DC offset, 0.2 s, and a 70 s clip of four sections (music, rain, speech, music) |
| texture, mix | 3     | Rain, room tone, speech over music                                                                                                                                     |
| film         | 10    | 180×320 at 30 fps, about 40 s, 32-35 hard cuts between flat colour cards, hits planted at known offsets                                                                |

Each fixture film plants, per cut, one of: a hit on the cut, at +20, +60, +120, +180 or −80 ms, a swell peaking on
the cut, a smooth swell peaking 200 ms after it, or no sound (`truth.plants`, with the planted attack or peak time
`eventS`). `film-00` is the reference film: a pad bed, every kind of plant, and a seed on which upstream's cut sync
reads each of its six statuses (OK, near, swell, peak, off, no sound) at least three times. The other nine vary the
mix for the critique: drum beds at 96-150 BPM, no bed, speech, a quiet master, a clipped master, a 3 s silent intro,
fades, everything 120 ms late, and a mono mix.

Generated clips are float32 WAV at 48 kHz and are not committed (about 220 MB): `gen/catalogue.mjs` renders them
in a few seconds, in float64 with a seeded PRNG and V8's fdlibm maths, so the bytes are the same on every machine and
the manifest's sha256 proves it. Upstream analysed each clip as `<id>.wav`; films' pictures as `<id>.mp4` (MPEG-4
part 2, bit-exact flags, not committed: `writeFilmVideo` rebuilds one).

Downmixes: for a stereo clip (the films), `audio.load(mono=True)` in earshot is FFmpeg's `-ac 1` downmix,
(L + R)·√½, while `audio.to_mono` of the stereo decode is the mean. Which one a path reads is noted on `mono` and
`ffmpegMono` in `fixtures.mjs`.

## The fixtures

```text
fixtures/manifest.json              clips (params, truth, sha256), every file's sha256, upstream pins, versions
fixtures/clips/sfx/*.wav            the 14 bank renders (16-bit mono)
fixtures/cli/<command>.json         describe, measure (--music), realness, match, rank, find, compare, ab,
                                    timeline, critique, sfx-check, sfx-render: { runId: { argv, exit, result } }
fixtures/kits/<preset>/             kit.json, kit.lock.json for calm, crisp, minimal, launch
fixtures/intermediates/index.json   every float32 array: group file, offset (floats), shape, sha256
fixtures/intermediates/*.f32        little-endian float32, row-major, one file per group
fixtures/intermediates/*.json       text, clap-audio, borderline, clap-features, ast, onsets, beats, sections, realness
```

Run ids: per clip for describe, measure, realness, timeline (music, films, the long clip, the mix, rain, speech-01),
critique (films) and sfx-check (plus `<id>::category`); `<clip>::<set>` for match (`::alts`, `::queries`, hint and
borderline sets; the borderline terms are the vocabulary terms nearest z 2.0, 2.5 and 3.0, listed in
`manifest.borderline`); the query for rank; `<clip>::<query>[::args]` for find; the clip for compare;
`NN:<a>~<b>` for ab. `argv` is the exact command line. Wall-clock timings (`timing_s`, critique's `seconds`) and
`cached` are removed from results, and so is the `text` rendering of timeline and critique (derived from the
result, about 200 kB; `summary` stays). The recorded SFX render summaries replace the recorder's personal
home-directory prefix with `~/`; the manifest hashes cover that redacted text. Audio bytes, seeds and measured
metadata are unchanged.

Float32 groups: `clap-text` (`vocab` 322×512 template-averaged and renormalised as `earshot.vocab` makes them,
`queries`, `templates` raw rows), `clap-audio` (pooled per clip), `clap-audio-windows` (the ≤ 6 windows of
`vocab.spans_for`), `calib-z-vocab` (z over the 322 terms, every clip), `calib-query` (cos, u, z for every query),
`calib-vocab-full` (cos, u, z over the terms for 6 clips), `clap-features` (the feature extractor's log-mel input,
1001×64, for 3 windows), `ast-logits` (per 10.24 s window), `ast-probs`, `ast-fbank` (the leading frames, up to
the valid ones + 16 of padding and at most 256: frames are computed one by one), `ast-resample-16k`, `onset-odf`
and `onset-z` (superflux at 5 ms), `onset-logmel`, `level-envs`, `pulse-envs`, `section-windows` (3 s CLAP
windows), `realness` (the 12 prompts, and the windows the CLAP head read where they differ from the describe
window; `intermediate('realness').clips[id].embeddings` names the array).

## Licences and credits

The fixtures are test data, not part of the app; [NOTICE](NOTICE) credits what they hold:

- **earshot** (MIT, copyright (c) 2026 Leon Lin): every result is its output, and `fixtures/clips/sfx` holds 14
  renders of its sound bank.
- **CLAP** (Apache-2.0) and **AST** (BSD-3-Clause): their embeddings, scores and logits, never their weights.
- **AudioSet's 527 class names** (Google Inc., CC BY 4.0, from `class_labels_indices.csv`): `labels` in
  `fixtures/intermediates/ast.json`, and the top labels in `cli/describe.json` and `cli/timeline.json`, unchanged.
  AudioSet's ontology file (`ontology.json`, CC BY-SA 4.0) is never vendored: no class descriptions, no hierarchy.

## Check

```sh
node tools/earshot-parity/check.mjs            # manifest, sha256 of every file and array, schemas, clip set,
                                               # budget, and every generated clip regenerated (about 10 s)
node tools/earshot-parity/check.mjs --no-clips # without regenerating
```

The root `pnpm test:scripts` (and so `pnpm check`) runs the first form: Node only, offline, no uv or Python.

## Regenerate

```sh
# once: upstream at the pin, a Python 3.12 venv, the pinned models (about 1.1 GB)
git clone https://github.com/Leonxlnx/earshot ~/.cache/taalcut-ear1/earshot
git -C ~/.cache/taalcut-ear1/earshot checkout ff41f0788ae56896fd59879ab03858d223c06a53
uv venv ~/.cache/taalcut-ear1/venv --python 3.12
uv pip install --python ~/.cache/taalcut-ear1/venv/bin/python ~/.cache/taalcut-ear1/earshot   # torch from the CPU index ([tool.uv])
EARSHOT_HOME=~/.cache/taalcut-ear1/earshot-home HF_HOME=~/.cache/taalcut-ear1/hf \
  ~/.cache/taalcut-ear1/venv/bin/earshot doctor --fetch

# the fixtures (FFmpeg on PATH, Node 24)
~/.cache/taalcut-ear1/venv/bin/python tools/earshot-parity/upstream/build.py
node tools/earshot-parity/check.mjs
```

`upstream/build.py` runs four stages (`--stages clips,inter,cli,manifest`): the clips (Node generator, bank
renders), the intermediates (upstream's Python API), the CLI runs (`earshot.cli.main` in process, so the models
stay warm), and the manifest. It forces `EARSHOT_PRECISION=fp32` and `EARSHOT_THREADS=4`; the manifest records the
versions and each model's precision. Work files go to `~/.cache/taalcut-ear1/earshot-home/parity`. A full build
from cold caches takes about 20 minutes on an M-series Mac (see the EAR1-F2 report); with warm caches about 10.
`earshot-home/hf` is a link to `~/.cache/taalcut-ear1/hf/hub`, so other lanes find the pinned models in the shared
Hugging Face cache.

## Upstream behaviour worth knowing

- **Precision.** earshot runs bf16 only on CPUs with AVX512-BF16 or AMX; Apple silicon runs fp32 either way. The
  fixtures are fp32. `vocab_stats.json` itself was built by upstream with bf16 weights.
- **Caches.** Decoded audio, embeddings and timeline results are cached under `EARSHOT_HOME`, keyed on path, size,
  mtime and sampled bytes, so regenerated clips are always analysed afresh. Text embeddings are cached by text.
- **Cut detection** (`earshot/video.py`, `method='diff'`): 96×54 grey frames at the native rate, a frame-difference
  peak at least 4× the median of the surrounding second and over 1.2 % grey change (or any change ≥ 15 %), at most
  one per 0.12 s. On the flat-card films it finds every planted cut exactly (`timeline.cuts`).
- **Two downmixes** for stereo input, above.
