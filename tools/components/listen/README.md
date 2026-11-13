# The listening models (EAR1-F3)

The earshot port (plan/earshot-round-1.md) hears with two models, run on ONNX Runtime with no Python:

- **CLAP** (`laion/larger_clap_general`, Apache-2.0): an audio encoder and a text encoder whose 512-d embeddings
  share one space, for describe, match, rank, sections and realness.
- **AST** (`MIT/ast-finetuned-audioset-10-10-0.4593`, BSD-3-Clause): the AudioSet tagger, 527 labels.

Each is a component in `../manifest.listen.provisional.json`, built from Xenova's ONNX exports pinned by commit, as an
**int8 base** (the CPU build) and an **fp16 variant** (Metal, through ONNX Runtime's WebGPU provider). All six are on
demand (`tiers: []`): the first listen fetches the audio encoders, the first free-text search the text encoder. The
file is in `compose-provisional.mjs`'s `SOURCES` since a release hosted them on 2026-11-07, so the shipped manifest
(sequence 20) has all six.

## Components

| Base (int8)          | Variant (fp16)            | What it is                                | Version                                |
| -------------------- | ------------------------- | ----------------------------------------- | -------------------------------------- |
| `clap-general-audio` | `clap-general-audio-fp16` | CLAP's audio encoder, with the text banks | `16c8cc31-onnx-<dtype>-d78c3994-text1` |
| `clap-general-text`  | `clap-general-text-fp16`  | CLAP's text encoder                       | `16c8cc31-onnx-<dtype>-d78c3994`       |
| `ast-audioset`       | `ast-audioset-fp16`       | AST, the AudioSet tagger                  | `f826b80d-onnx-<dtype>-249a1fbf`       |

The version names the upstream weights' revision, the dtype and Xenova's export revision. Every build depends on
`onnxruntime` (`compose-provisional.mjs`'s `CROSS_FILE_DEPENDENCIES`). The base lists its variant in `variants`; the
variant has `requires: { "platform": "darwin", "gpuApi": "metal" }`, so:

- a Mac whose probe reports Metal gets fp16;
- `TAALCUT_FORCE_CPU=1` (the probe drops every GPU API), a PC (CUDA or not) and a machine the probe couldn't describe
  get int8.

`packages/jobs/test/listen-components.test.ts` holds both, through `variantHere`.

The int8 graphs are 8-bit dynamic quantisation (QUInt8 weights, per channel); the fp16 graphs have float16 weights.
Both keep float32 inputs and outputs.

### Builds

What `pack-listen-models.mjs --twice` built on 2026-11-06 (the audio builds again with the text banks, as `-text1`) (darwin-arm64, bsdtar 3.5.3, zstd 1.5.7). Two packs gave the
same sha256 for every build. The manifest holds the same values.

| Component                 | File                                       | Size      | extractedSize | sha256                                                             |
| ------------------------- | ------------------------------------------ | --------- | ------------- | ------------------------------------------------------------------ |
| `clap-general-audio`      | `clap-general-audio-int8-d78c3994.tar.zst` | 56723868  | 79005452      | `134f87a8cf05d2ab5d830be95d1e00014122d3a9f33cb0c89bb361f860fb0522` |
| `clap-general-audio-fp16` | `clap-general-audio-fp16-d78c3994.tar.zst` | 127124378 | 144282246     | `7721b8d35b6551dc7b5ad49dbef20b88df9c55af12a5ae84405a5044d9bac23b` |
| `clap-general-text`       | `clap-general-text-int8-d78c3994.tar.zst`  | 96579785  | 129969591     | `a488a91be2f46be0e29343762dd7d21957a78baf909878a39b7a5990ab1257d6` |
| `clap-general-text-fp16`  | `clap-general-text-fp16-d78c3994.tar.zst`  | 232031826 | 254395416     | `82f5efe2d77c235f6e8bb901b633d96d016b4ea05a853df4fe015a40ae7b1756` |
| `ast-audioset`            | `ast-audioset-int8-249a1fbf.tar.zst`       | 65424314  | 90834475      | `30d417f14028bd953891f5848935dd1af92d042a68f1179a3fc27b677816edf6` |
| `ast-audioset-fp16`       | `ast-audioset-fp16-249a1fbf.tar.zst`       | 159420203 | 173713987     | `5821d22fe11a5070b2c564369f39174ac93e0a6eb202c4b18d57370b77eb60e1` |

Hosted on components.taalcut.app on 2026-11-07, each with its notice, at the urls in the manifest: `verify.mjs`
downloaded every one from the public domain with the size and sha256 above. The four text-bank files are hosted on
their own too, at `listen-text/<sha12>/<file>`, the urls `../hosting/plan/listen.mjs` pins.

## Sources

Every file is pinned by size and sha256 in `../hosting/plan/listen.mjs`.

- `Xenova/larger_clap_general` at `d78c3994912c441f0151a5cc44d86f6b7bf4c861` (the export of
  `laion/larger_clap_general` at `16c8cc3159a3c8a31e8ff5ef1f66b0d9ab3667db`):
  - `onnx/audio_model_quantized.onnx` (78155433 bytes) and `onnx/audio_model_fp16.onnx` (143432227);
  - `onnx/text_model_quantized.onnx` (126603263) and `onnx/text_model_fp16.onnx` (251029088);
  - `config.json`, `preprocessor_config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`,
    `vocab.json`, `merges.txt`.
- `Xenova/ast-finetuned-audioset-10-10-0.4593` at `249a1fbf0286b40e7f1ed687a8ae396997bf7dc6` (the export of
  `MIT/ast-finetuned-audioset-10-10-0.4593` at `f826b80d28226b62986cc218e5cec390b1096902`):
  - `onnx/model_quantized.onnx` (90807386) and `onnx/model_fp16.onnx` (173686898);
  - `config.json`, `preprocessor_config.json`.

Xenova's own `quantize_config.json` is left out: it describes the conversion, not anything the runtime reads.

## Archive layout

One flat `tar.zst` per build, `stripComponents` 0: the graph is renamed `model.onnx`, and every other file keeps its
upstream name and bytes. A base and its variant hold the same configs; only `model.onnx` differs.

| Component                   | Files at the archive root                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clap-general-audio[-fp16]` | `config.json`, `listen-text-fp16.f16`, `listen-text-fp16.json`, `listen-text-int8.f16`, `listen-text-int8.json`, `model.onnx`, `preprocessor_config.json` |
| `clap-general-text[-fp16]`  | `config.json`, `merges.txt`, `model.onnx`, `special_tokens_map.json`, `tokenizer.json`, `tokenizer_config.json`, `vocab.json`                             |
| `ast-audioset[-fp16]`       | `config.json`, `model.onnx`, `preprocessor_config.json`                                                                                                   |

What the runtime (EAR1-F4) reads:

| File                                  | Contents                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLAP audio `model.onnx`               | input `input_features` float32 `[batch, 1, frames, 64]` (the log-mel front end); output `audio_embeds` float32 `[batch, 512]`                                                 |
| CLAP audio `preprocessor_config.json` | `ClapFeatureExtractor`: 48 kHz, `n_fft` 1024, hop 480, 64 mel bins from 50 Hz to 14 kHz, 10 s (`nb_max_samples` 480000), `repeatpad`                                          |
| CLAP text `model.onnx`                | input `input_ids` int64 `[batch, tokens]` (no attention mask: embed one query per run, or batch only queries of the same length); output `text_embeds` float32 `[batch, 512]` |
| CLAP text `tokenizer.json`            | RoBERTa's byte-level BPE, for `@huggingface/tokenizers` (`vocab.json` and `merges.txt` are the same vocabulary)                                                               |
| AST `model.onnx`                      | input `input_values` float32 `[batch, 1024, 128]` (the fbank front end); output `logits` float32 `[batch, 527]`                                                               |
| AST `preprocessor_config.json`        | `ASTFeatureExtractor`: 16 kHz, 128 mel bins, 1024 frames, normalised with mean -4.2677393 and std 4.5689974                                                                   |
| AST `config.json`                     | `id2label`: the 527 AudioSet class names                                                                                                                                      |
| `config.json` (CLAP)                  | `projection_dim` 512 and the architecture; `logit_scale` comes from earshot's `vocab_stats.json` (EAR1-F1)                                                                    |

### Text embeddings (EAR1-F5, D23)

Both audio builds also carry the CLAP text embeddings of everything earshot embeds from fixed text, one bank per text
dtype, so describing a sound, its sections, event tags, realness and a search's kind check need no text model; only
free text loads `clap-general-text`. `listen-text-<dtype>.json` is the index (model, dtype, and per set its phrases,
the vocabulary's categories, its templates and their sha256); `listen-text-<dtype>.f16` holds the rows, float16
little-endian, 512 each, the sets one after another: the 322-term vocabulary, timeline's 49 event phrases, search's
12 kind anchors and realness's 12 prompts (`packages/audio/src/listen/calibrate/phrase-sets.ts`). The runtime picks the
bank of the text dtype in use (`calibrate/text.ts`).

They are built with the TypeScript runner on the unpacked text builds, on the CPU provider (deterministic here, and
where the int8 build runs), and committed in `text-embeddings/`, so the archives pack the same bytes on any machine:

```sh
node tools/components/listen/build-text-embeddings.mjs           # writes text-embeddings/
node tools/components/listen/build-text-embeddings.mjs --check   # rebuilds and compares (cosine ≥ 0.9999)
```

`../hosting/plan/listen.mjs` pins the four files (size, sha256) under a components.taalcut.app url that a release
will host; `pack-listen-models.mjs` puts the committed bytes, and earshot's MIT licence for the notice, into the cache
first, so packing downloads nothing for them. Rebuilt banks need a new `-textN` version of both audio builds.

## Finding the files at run time

A component installs into `<userData>/components/installed/<id>/<version>-<sha12>/`. Code never builds that path; it
asks the component manager:

```ts
// In a utility root (apps/desktop/src/utility/roots/*): `components` is the jobs process's installer
// (core's ComponentInstallerPort, through main). `variant: true` installs the build that runs here, as the
// download picks it (jobs' variantHere): clap-general-audio-fp16 on a Metal Mac, clap-general-audio elsewhere.
const installed = await components.install('clap-general-audio', { variant: true, signal });
if (!installed.ok) return installed; // F7 maps this to audio.listen_model_missing, naming the component
const dtype = installed.value.id.endsWith('-fp16') ? 'fp16' : 'int8'; // part of the analysis cache key
const model = join(installed.value.path, 'model.onnx');
const preprocessor = join(installed.value.path, 'preprocessor_config.json');
```

Without installing anything, `components.get('<id>-fp16') ?? components.get('<id>')` says what is there, and
`installedComponentDirSync(componentsRoot, id)` (`@taalcut/jobs`) answers synchronously. `roots/audio.ts`'s
`AUDIO_COMPONENTS` maps ids to files the same way; EAR1-F7 adds the listening ids in `roots/audio-listen.ts`.

## Building

```sh
node tools/components/listen/pack-listen-models.mjs --twice --write-manifest
```

It runs `hosting/build.mjs --pending` for these six only, with every build packed afresh (`--rebuild`), into a local
release outside the repository, then unpacks each build as it installs. Everything lives under `~/.cache/taalcut-ear1`
(`--home` or `TAALCUT_EAR1_HOME` moves it):

| Folder              | What                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `components-cache/` | The pinned files and built archives, named by sha256 (about 1.6 GB)                           |
| `release/`          | `release.json`, `objects/<id>/<version>/<file>` and each `NOTICE-<sha>.txt`: a release folder |
| `release-check/`    | The second pack (`--twice`), compared with the first                                          |
| `models/<id>/`      | Each build unpacked: `model.onnx` and its configs                                             |

The archive recipe is `hosting/archive.mjs`'s layout `file` (Beat This!'s): names in byte order, ustar, uid and gid 0,
mode 0644, mtime 0, then `zstd -19 -T1` on the tar file. `--write-manifest` writes each build's size, sha256,
extractedSize and notice into the manifest (`hosting/write-manifest.mjs --pending`). Packing is the slow part (zstd
level 19 on one thread, about 860 MB of graphs per pack); downloads happen once.

## Testing with the real models

**In a development run:** the release folder is what `TAALCUT_DEV_COMPONENTS` reads (apps/desktop
`roots/dev-components.ts`). The app installs these six from a loopback server with the usual size and sha256 checks,
and everything else from components.taalcut.app:

```sh
TAALCUT_DEV_COMPONENTS=$HOME/.cache/taalcut-ear1/release pnpm dev
```

Several release folders join like PATH (`<this>:<another>`), so a lane with its own pending builds (the `sfx-bank`)
can serve both. Checked on 2026-11-06: `startDevComponents` over this release, then the component manager installed
`clap-general-audio` and `ast-audioset-fp16` from it (and `onnxruntime` from the host), each unpacked by the app's own
extractor to `model.onnx`, its configs and `TAALCUT-NOTICE.txt`.

**In Vitest:** load the unpacked builds directly, gated so CI (which has no models) skips the test:

```ts
const MODELS = process.env.TAALCUT_EAR1_MODELS; // e.g. ~/.cache/taalcut-ear1/models
describe.skipIf(!MODELS)('CLAP audio against upstream', () => {
  const model = (id: string) => join(MODELS!, id, 'model.onnx');
  // model('clap-general-audio-fp16'), model('clap-general-text'), model('ast-audioset'), …
});
```

```sh
TAALCUT_EAR1_MODELS=$HOME/.cache/taalcut-ear1/models pnpm --filter @taalcut/audio test -- listen
```

## Licences

| Component             | SPDX                         | Notice texts                                                                                                                                       |
| --------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clap-general-audio*` | `Apache-2.0 AND MIT`         | Apache-2.0 from apache.org, and earshot's MIT licence (Leon Lin, `Leonxlnx/earshot` at `ff41f078`): the phrases the text banks embed are earshot's |
| `clap-general-text*`  | `Apache-2.0`                 | Apache-2.0 from apache.org (`laion/larger_clap_general` ships no licence file)                                                                     |
| `ast-audioset*`       | `BSD-3-Clause AND CC-BY-4.0` | The AST authors' BSD-3-Clause (`YuanGongND/ast` at `31088be8`), and CC BY 4.0's legal code                                                         |

The audio builds' SPDX names MIT for the text banks they carry (EAR1-R5). The SPDX lives in the manifest and the
notice, not in the archive: adding MIT changed each audio build's notice, and a repack on 2026-11-07 gave the same
sha256 as above.

AST's `config.json` carries AudioSet's 527 class names, from the AudioSet dataset's `class_labels_indices.csv`
(Google Inc., CC BY 4.0), so the AST components state CC BY 4.0 with their attribution. Google publishes the AudioSet
ontology file itself (`ontology.json`, with the class descriptions) under CC BY-SA 4.0; no component ships it.

Each build's notice (`NOTICE-<sha>.txt` beside it, pinned in `licence.notice`) says what it is, its licence and
attribution, that Taalcut repacked the upstream files unchanged with the graph renamed `model.onnx`, the upstream and
export revisions, and quotes every licence text in full.

## Open items

- **`TAALCUT_FORCE_CPU` on a Mac.** The Linux and Windows probes apply it (`applyAcceleratorEnv`); the Mac probe
  (`createMacHardwareProbe`) doesn't, so a Mac still reports Metal and gets fp16. Until it does, a Mac CPU-only run
  needs the int8 ids asked for by name.
