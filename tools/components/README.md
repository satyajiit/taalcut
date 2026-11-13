# Component manifests

Taalcut's installer stays small. The ONNX runtime (~258 MB), the on-device models and the reference fetcher are
**components**: downloaded on demand, checked against a sha256, and installed into
`<userData>/components` by the download manager in `packages/jobs` (PRD G13, plan P1-E3).

| File                                          | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.schema.json`                        | JSON Schema for manifests. **Generated**, do not edit: `pnpm --filter @taalcut/jobs run schema:export`                                                                                                                                                                                                                                                                                                                                                                                                         |
| `manifest.example.json`                       | Example with every planned component. **All values are placeholders**: the sha256 is all zeros, sizes and versions are guesses, URLs are on the reserved `.invalid` domain                                                                                                                                                                                                                                                                                                                                     |
| `manifest.local-llm.provisional.json`         | The embedded local LLM (spike 08): llama.cpp b11571 for macOS arm64 (re-signed with the Developer ID), Qwen3.5 4B Q4_K_M and its BF16 projector (Recommended and High), Qwen3.5 0.8B Q4_K_M (Minimum)                                                                                                                                                                                                                                                                                                          |
| `manifest.vision.provisional.json`            | Vision: `onnxruntime` (onnxruntime-node 1.30.0's darwin-arm64 binding, Developer ID-signed by `pack-onnxruntime.sh`), EmbeddingGemma 2 (q4 text, q4f16 vision) and its Core ML build for macOS 15+ (`pack-embeddinggemma-coreml.sh`), PP-OCRv5 Devanagari, TransNetV2 and its Core ML build (`pack-transnetv2-coreml.sh`)                                                                                                                                                                                      |
| `manifest.audio.provisional.json`             | Audio: `whisper-cpp` and `whisper-server` (static, Metal, Developer ID-signed, from `tools/whisper/build.sh`), the whisper ggml models and Beat This!                                                                                                                                                                                                                                                                                                                                                          |
| `manifest.render.provisional.json`            | Render: the pinned chrome-headless-shell (Developer ID-signed, `allow-jit` only) and the C2PA sidecar                                                                                                                                                                                                                                                                                                                                                                                                          |
| `manifest.reference-fetcher.provisional.json` | The reference fetcher (P2-T3), on demand only: yt-dlp 2026.10.21, built by Taalcut from its tagged source (`yt-dlp/`; GPL-3.0-or-later as a whole, its copyleft pieces' sources and the build scripts hosted beside it), and Deno 2.9.6 (npm's `@deno/darwin-arm64` tar.gz, Deno Land's own signature; its MPL-2.0 crates and the v8 crate hosted beside it)                                                                                                                                                   |
| `manifest.voice-music.provisional.json`       | Voice and music: Silero VAD 6.2.3 and the synthesised CC0 `sfx-pack` (`tools/audio-packs/build-sfx-pack.mjs`). The music pack waits for the product owner's track list (`tools/audio-packs/README.md`)                                                                                                                                                                                                                                                                                                         |
| `manifest.listen.provisional.json`            | Listening (EAR1-F3), pending until a release hosts it: CLAP's audio and text encoders and AST, each an int8 base with an fp16 variant for Metal, on demand only. Built by `listen/pack-listen-models.mjs`; see [listen/README.md](listen/README.md)                                                                                                                                                                                                                                                            |
| `manifest.linux.provisional.json`             | linux-x64 (LNX1-CMP, hosted since 2026-10-28): the Linux-only components (the CUDA runtime, the CUDA and Vulkan builds, PP-OCRv5 Latin) and, under `extend`, the linux-x64 artifacts of the others; see [Linux builds](#linux-builds)                                                                                                                                                                                                                                                                          |
| `manifest.provisional.json`                   | **Generated** by `compose-provisional.mjs`: the sources above as one, each source's `$comment` kept. Signed with the release key it is `manifest.signed.json`, the manifest the app ships (see its signed sequence)                                                                                                                                                                                                                                                                                                        |
| `compose-provisional.mjs`                     | Writes `manifest.provisional.json` from the sources (and the dependencies between them, e.g. Beat This! needs `onnxruntime`)                                                                                                                                                                                                                                                                                                                                                                                   |
| `hosting/`                                    | The release path to `https://components.taalcut.app` (Cloudflare R2): `build.mjs` (every component from its pinned source, signed, checked, with its corresponding sources (`sources.mjs`) and its notice), `notarize.mjs` (Apple's notary service), `upload.mjs` (R2's S3 API, multipart, SigV4 in `sigv4.mjs`), `write-manifest.mjs`, `verify.mjs`. `plan.mjs` and `plan/` say how each component is made; `texts.mjs` pins the licence texts                                                                |
| `entitlements/`                               | The only entitlement a component binary gets: `allow-jit` for chrome-headless-shell                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `yt-dlp/`                                     | The reference fetcher's build: `pack.mjs` builds yt-dlp's PyInstaller onedir from the pins in `pins.mjs` (yt-dlp's tag, python-build-standalone's CPython, upstream's hash-locked requirements), signs and runs it (`run-check.mjs`), inventories its licences (`inventory.py`, `inventory.mjs`) and packs it. See [The reference fetcher](#the-reference-fetcher)                                                                                                                                             |
| `deno/`                                       | Deno's generated notice: `notice.mjs` (build.mjs's `notice.generated: 'deno'`), from the pins and reviews in `pins.mjs` and the upstream licence files `discover.mjs` pins in `licences.json`. See [Deno's notice](#denos-notice)                                                                                                                                                                                                                                                                              |
| `linux/`                                      | The GNU-tool pack scripts for linux-x64 (LNX1-CMP): `pack-onnxruntime.sh` (`cpu`, `cuda`), `pack-cuda-runtime.sh`, `pack-whisper.sh` (`cpu`, `cuda`; `tools/whisper/build-linux.sh` in a pinned container), `pack-headless-shell.sh` and `build-c2pa.sh` (the c2pa recipe's linux-x64 build, in the same container), sharing `lib.sh`                                                                                                                                                                          |
| `listen/`                                     | The listening models' packer (`pack-listen-models.mjs`: hosting/build.mjs's `pack` recipe into a local release, twice with `--twice`, unpacked for tests) and their archive layout, pins and local-testing recipe (`README.md`)                                                                                                                                                                                                                                                                                |
| `pack-embeddinggemma-coreml.sh`               | Packs the `embeddinggemma-2-coreml` component: FluidInference's Core ML graphs at a pinned revision (checked against `embeddinggemma-coreml/checksums.txt`) with the `embeddinggemma-2` component's q4 weights written in (`embeddinggemma-coreml/q4_surgery.py`, pinned `requirements.txt`), compiled with `xcrun coremlcompiler`; prints the sha256, size and extractedSize                                                                                                                                  |
| `pack-onnxruntime.sh`                         | Packs the `onnxruntime` component from the workspace's onnxruntime-node, both Mach-O files signed with the Developer ID first; prints the sha256, size and extractedSize for the manifest                                                                                                                                                                                                                                                                                                                      |
| `pack-transnetv2-coreml.sh`                   | Packs the `transnetv2-coreml` component: upstream TransNetV2 at a pinned revision (checked against `transnetv2-coreml/checksums.txt`), its weights into upstream's PyTorch port, the Core ML rewrite and its fp32 conversion (`transnetv2-coreml/build.py`, pinned `requirements.txt`; build tools only), compiled with `xcrun coremlcompiler`, then the parity gate against the shipped ONNX on every ix-v1 window (`gate.py`; run it under the VideoToolbox lock); prints the sha256, size and extractedSize |
| `sign-manifest.mjs`                           | Signs a manifest with the manifest key (Ed25519, Node built-ins only), or creates that key once (`--generate`). See [Signed manifests](#signed-manifests)                                                                                                                                                                                                                                                                                                                                                      |

The sources keep their `.provisional` names because other packages' tests and docs read them by path; every file
they name is hosted. The zod schema in `packages/jobs/src/components/manifest.ts` is the source of truth; a test
fails if the JSON Schema here drifts from it.

## Fields

Each component has an `id` (kebab-case, stable: it names folders and the install job), a display `name`, a `version`,
a `kind` (`runtime`, `model`, `tool`), the hardware `tiers` that install it by default (`minimum`, `recommended`,
`high`, PRD G14; empty means on demand only), a `licence` and its `dependencies` (installed first).

Each component has one or more **artifacts**, at most one per `platform` (`darwin-arm64`, ..., or `any` for
platform-independent files such as model weights). An artifact has:

- `urls`: https only, tried in order. Mirrors must serve **byte-identical** files.
- `sha256`: lowercase hex of the downloaded file (of the archive, for archives). Compute it with
  `shasum -a 256 <file>`.
- `size`: exact size in bytes. A server that reports another size is refused.
- `install`: either `{ "type": "file", "fileName", "executable" }` (renamed into place; `executable` sets mode 755) or
  `{ "type": "archive", "format", "stripComponents", "extractedSize" }`.

## Requirements and variants

A component may say what the machine must have to run it, `requires`; the download set leaves out what this machine
doesn't meet (`machineFit` in `packages/jobs`). The keys are open, and one this build of the app doesn't know never
fits, so a newer manifest can guard a component an older app can't check:

| Key                    | Meaning                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `platform`             | `darwin`, `linux` or `win32` (for an `any` artifact that only one OS uses)               |
| `minOsVersion`         | The OS version, dotted (macOS `15`); needs `platform`                                    |
| `minGlibc`             | The C library the app runs on (`2.38`), for a Linux build linked on a newer distribution |
| `gpuApi`               | A GPU here must offer it: `cuda`, `vulkan`, `metal`, …                                   |
| `minDriver`            | That GPU's driver version (NVIDIA `580`); needs `gpuApi`                                 |
| `minComputeCapability` | That GPU's CUDA compute capability (`7.5`); needs `gpuApi`                               |
| `minVramBytes`         | That GPU's memory; needs `gpuApi`                                                        |

The GPU keys hold on one GPU together. An **accelerator build** is a component of its own (`onnxruntime-cuda`,
`whisper-server-cuda`, `local-llm-runtime-cuda`, `local-llm-runtime-vulkan`) with one artifact per platform, a
`requires`, empty `tiers`, and the CUDA runtime (`cuda-runtime-13`) among its `dependencies` when it loads CUDA. The
component the tiers list, the CPU build, names its accelerator builds in `variants`, most preferred first; the
download takes the first that has a build here and fits, else the CPU build. Dependencies always name the component
they need, so a model's `onnxruntime` installs beside `onnxruntime-cuda` (the app loads the CUDA binding first). The
app logs which build each group got and why it passed over the others (`[components] onnxruntime: onnxruntime-cuda
(…)`).

`cuda-runtime-13` is NVIDIA's redistributable CUDA 13 libraries and cuDNN 9, unchanged, shared libraries only
(`lib/`). NVIDIA owns them and licenses them to the person under its own terms, so the component states
`licence.acceptance` (see [Terms the person accepts](#terms-the-person-accepts)) and downloads only once they are
accepted in the app; until then each group takes its next build (llama.cpp on Vulkan, ONNX Runtime on WebGPU and the
CPU, whisper.cpp on the CPU). The app puts its `lib` folder first on `LD_LIBRARY_PATH` for the processes it starts (`acceleratorEnv()`
in `apps/desktop/src/utility/accelerator-env.ts`), since Linux reads that only when a process starts: a utility
process started before the runtime installed needs a restart to use it. The CUDA builds need NVIDIA's driver 580 or
later, which the system provides.

## Archives

Formats are `tar`, `tar.gz` and `tar.zst`, so extraction needs only Node built-ins. Repackage zip or bz2 upstreams
(Deno, sherpa-onnx models) before hosting. `extractedSize` is the sum of the sizes of the regular files in the
archive: it feeds the disk-space check and is a hard cap (extraction stops if the archive holds more). Create archives
with `COPYFILE_DISABLE=1 tar` so macOS metadata files stay out. On Linux the pack scripts use GNU tar with fixed owners, mode and mtime and a sorted file list, then
`zstd -19` on a file (`linux/lib.sh`'s `pack_tree`), so a second run gives the same bytes. Archives may contain files, folders and relative
symlinks that stay inside the component folder; hard links, devices, absolute paths and `..` are refused. The MLX 9B model
explicitly pins `compressionLevel: 3`; all other hosting recipes retain level 19. Both use one thread and deterministic tar metadata.

## Licences and attribution

`licence.spdx` is an SPDX expression. CC BY licences (Parakeet TDT is CC-BY-4.0) are rejected without
`licence.attribution`, which Settings → About shows. Name the upstream and any changes (conversion, quantisation).

Hosting a third-party file is redistributing it, so every component has a notice beside its file
(`<id>/<version>/NOTICE-<first 16 hex digits of its sha256>.txt`), and `licence.notice` pins it like an artifact:
`{ "url", "size", "sha256" }`. It
says what the component is, its licence and attribution, what Taalcut changed (signed, notarised, repacked, built,
or nothing), where the corresponding source of its copyleft pieces is, and the full text of every licence that
applies, pinned by sha256 in `hosting/texts.mjs` (or taken from the archive itself, such as Chromium's
`LICENSE.headless_shell`, the C2PA sidecar's and yt-dlp's `LICENSES/`), or, for Deno, generated from its lock
([Deno's notice](#denos-notice)). Like every hosted object it is immutable,
and its name is its content: a corrected notice gets a new key on its own, and the component keeps its version and
bytes (the app decides on an update from the version and the file's sha256, never the notice). Sequence 15's
notices stay at their `NOTICE.txt` keys for as long as anything may still read that manifest.

### Terms the person accepts

A component whose owner licenses it to the person under the owner's own terms (NVIDIA's CUDA runtime and cuDNN)
states them in `licence.acceptance`, and the app asks before it downloads anything of it (LNX1-TRM):

```json
"acceptance": {
  "owner": "NVIDIA Corporation",
  "termsVersion": "2026-10-27",
  "documents": [
    { "title": "CUDA Toolkit End User License Agreement", "url": "https://docs.nvidia.com/cuda/eula/index.html" },
    { "title": "NVIDIA cuDNN Software License Agreement", "url": "https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html" }
  ]
}
```

- `owner`: who makes and owns it. The card says the files are the owner's, licensed to the person by the owner, and
  that Taalcut doesn't own, change or sell them, only downloads and installs them at the person's request.
- `termsVersion`: an explicit string. Change it when the terms change: everyone is asked again, and an update of an
  installed copy waits for the new acceptance.
- `documents`: the title and the owner's official https page of each licence text, linked from the card and from
  Settings. Check that each URL resolves before publishing.

Until the person accepts, the component and everything that depends on it stay out of the download (each variant
group falls back to its next build, logged with the reason) and an install is refused (`jobs.terms_not_accepted`);
the acceptance is an acknowledgement under `component.terms:<id>` and that version. Older builds ignore the field,
which is acceptable only because such a component is reached through `variants`, which builds before LNX1 don't read.
`write-manifest.mjs` keeps it, and the plan (`hosting/plan/linux.mjs`, `NVIDIA_ACCEPTANCE`) names the same object for
the notice; `test/linux-manifest.test.ts` holds the two equal. Say the same thing in the notice: whose the files are,
under which terms, and that Taalcut downloads them only after the person accepts.

**Corresponding sources.** The exact source of every copyleft piece in a hosted component is hosted beside it under
the same version, in `source/`, for as long as the component is (`plan/*.mjs`, each component's `sources`):

| Component                    | Copyleft pieces                                                                                                                                              | Hosted under `source/`                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `reference-fetcher`          | mutagen (GPL-2.0-or-later), the PyInstaller bootloader (GPL-2.0-or-later with its exception), certifi (MPL-2.0); the build as a whole is GPL-3.0-or-later    | their PyPI sdists (sha256 in upstream's lock), yt-dlp's tagged source, Taalcut's build scripts (`taalcut-yt-dlp-build-<version>.tar.zst`) |
| `hyperframes-headless-shell` | Blink and WebKit (LGPL-2.0/2.1), FFmpeg (LGPL-2.1), libusbx (LGPL-2.1), the symphonia crates (MPL-2.0)                                                       | Chromium's official source release of the same version                                                                                    |
| `onnxruntime`                | Eigen (MPL-2.0)                                                                                                                                              | the Eigen archive ONNX Runtime's `cmake/deps.txt` pins                                                                                    |
| `deno`                       | cooked-waker, cssparser, cssparser-macros, dtoa-short, smartstring, webpki-root-certs, webpki-roots (MPL-2.0); glibc's sin and cos in V8 (LGPL-2.1-or-later) | `crates/`: crates.io's packages deno's `Cargo.lock` names, the v8 crate (V8's source, `third_party/glibc` in it) among them               |
| `c2pa-sidecar`               | taalcut-c2pa itself (AGPL-3.0-or-later)                                                                                                                      | `native/c2pa-sidecar` with its `Cargo.lock` and `build.sh`                                                                                |

Every other component and piece is under permissive licences, quoted in its notice. A repo source (Taalcut's own
scripts) is packed with the archive recipe from the repository; once hosted, `hosting/plan/hosted.mjs` records it by
key, so a later release of that version fetches the hosted bytes instead of packing scripts that have moved on.
`pnpm notice` lists every component with its notice url in the repository's `NOTICE`.

## Signed manifests

The app uses a manifest only if it is signed: `{ "manifest": { ... }, "signatures": [{ "keyId", "sig" }] }`.
`loadSignedManifest` in `packages/jobs` checks the signature over the raw payload before it reads any entry, so
nothing is downloaded from a manifest that isn't ours. Every refusal is `jobs.manifest_untrusted` with a `reason`,
and is logged.

- **Signature.** Ed25519 over `taalcut-component-manifest/v1\n` followed by the payload as canonical JSON (keys
  sorted, no whitespace). `keyId` is the first 16 hex digits of the sha256 of the raw public key.
- **Pinned keys.** `packages/jobs/src/components/trusted-keys.ts` pins at most two public keys, the current one and
  the next one. A signature by any other key is `unknown_key`; one that doesn't match is `bad_signature`.
- **Expiry.** The payload's `notAfter` (UTC, ends in `Z`) is when the app stops accepting it (`expired`). Publish a
  fresh manifest well before then; `sign-manifest.mjs` defaults to 180 days.
- **Anti-rollback.** The payload's `sequence` goes up with every publication. The app keeps the highest sequence it
  has accepted (`<userData>/components/manifest-state.json`) and refuses a lower one (`rollback`), so an old
  manifest with old, vulnerable binaries can't be replayed. The same sequence again is accepted.
- **Release key.** The pinned key is the release key, `438da86c0fbd96ef` (2026-10-25); it signs
  `manifest.signed.json` from sequence 17 on.
- **Development key.** `packages/jobs/test/fixtures` holds a development key whose private half is committed (not a
  secret). It is never pinned in `trusted-keys.ts`; tests pass it explicitly. A checkout may pin it to try a manifest
  it signed: a development build accepts that, and so does a build run from a checkout (`pnpm dev` bundles the
  release flavour, unpackaged), but a packaged release build refuses to start the component manager while it is
  pinned (`development_key`, UX2-MODELS).

### The manifest key

The private key lives in the owner's login keychain (generic password, service `taalcut-manifest-key`), or in a
file outside the repository named by `TAALCUT_MANIFEST_KEY_FILE` (PKCS#8, PEM or base64 DER). `sign-manifest.mjs`
refuses a key file inside the repository.

Creating it (the owner, once; not part of any build):

```sh
node tools/components/sign-manifest.mjs --generate
```

This stores a new private key in the keychain (passed to `security` on stdin, so it never appears in a process
listing; an existing `taalcut-manifest-key` is never overwritten) and prints the `{ keyId, publicKey }` line for
`trusted-keys.ts`. The release key was made this way on 2026-10-25 (`438da86c0fbd96ef`). Keep an offline backup of
the private key (Keychain Access, item `taalcut-manifest-key`, the password field: base64 PKCS#8 DER) in the
owner's password manager: without it no new manifest can be signed for builds that pin only this key. The app
bundles its manifest and fetches none, so a lost key breaks no installed app; the next build would pin a new one.

**Rotation.** Pin the next key beside the current one and ship that build. Sign manifests with both keys (signing an
already signed file adds a signature and leaves the payload alone). Once builds that pin only the old key are gone,
drop it from `trusted-keys.ts`. A second key in the keychain needs its own service name
(`TAALCUT_MANIFEST_KEYCHAIN_SERVICE`).

## Releasing components

Every component file is hosted at `https://components.taalcut.app/<id>/<version>/<file>` (Cloudflare R2, bucket
`taalcut-components`) and nowhere else: the app depends only on Taalcut's domain. A hosted key never changes bytes
(every object is served `immutable`, notices and sources included): a changed file gets a new `version`.

Before a beta or public release, check the native browser against Google's current stable security advisories and
Chrome for Testing downloads. npm's audit does not cover that binary. HyperFrames' default browser version may
lag security releases; Taalcut's explicit path and expected-major pin must be updated together with the signed
component, both platform archives, corresponding Chromium source and notices. Prove the change with actual
frame-accuracy renders and workspace sandbox tests before promoting the manifest.

One release is this sequence, from the repository root:

```sh
# 1. Build: every component from its pinned source (hosting/plan.mjs), every Mach-O signed with the Developer ID
#    (hardened runtime, secure timestamp, codesign --verify --strict), checked, with its notice.
#    Writes tools/components/.cache/release/release.json and prints each file's size, sha256 and extractedSize.
TAALCUT_MAC_IDENTITY="Developer ID Application: Matterward Labs Private Limited (WW382UC8JD)" \
  node tools/components/hosting/build.mjs

# 2. Notarise every component whose Mach-O files Taalcut signed (notarytool keychain profile TAALCUT_NOTARY_PROFILE,
#    default taalcut-notary; TAALCUT_NOTARY_KEYCHAIN if it isn't in the default keychain). Records each submission
#    in release.json; a missing profile fails the run.
node tools/components/hosting/notarize.mjs

# 3. Upload what isn't hosted yet (credentials: ~/.config/taalcut/r2-components.env, mode 600). Refuses a release
#    with a component that needs notarisation and has no Accepted submission for its bytes.
node tools/components/hosting/upload.mjs

# 4. Write the hosted urls, sha256, sizes and notices (url, size, sha256) into the manifest sources, and recompose.
node tools/components/hosting/write-manifest.mjs

# 5. Sign with the next sequence and check it as a build of this checkout would load it.
node tools/components/sign-manifest.mjs tools/components/manifest.provisional.json \
  --out tools/components/manifest.signed.json --sequence <last + 1>
pnpm --filter @taalcut/jobs run manifest:verify tools/components/manifest.signed.json --after <last>

# 6. Check every manifest url from the public domain: ranges, headers, size and sha256 of the whole file, and every
#    notice against the size and sha256 its licence.notice pins; --sources checks the hosted sources too.
node tools/components/hosting/verify.mjs --sources tools/components/.cache/release/release.json

# 7. Record new repo sources in hosting/plan/hosted.mjs, regenerate NOTICE (notice urls), then commit the
#    manifests and NOTICE.
pnpm notice
```

- **Build** reuses a component's file when the sha256 cache (`tools/components/.cache/sha256`) holds the bytes the
  manifest names and they pass the signing policy, so a second run changes nothing. Anything else is built:
  pinned upstream files (downloaded once, checked by size and sha256 before anything reads them; `pinned.mjs`
  retries a stall, a reset or a 5xx/408/429 with backoff and resumes from the bytes it has, and fails at once on a
  403, 404 or other refusal), the repository's
  own pack scripts (`pack-onnxruntime.sh`, `pack-embeddinggemma-coreml.sh`, `pack-transnetv2-coreml.sh`,
  `tools/whisper/build.sh`, `build-sfx-pack.mjs`, `fetch-shell.mjs --pack --sign`, `native/c2pa-sidecar/build.sh`),
  or an upstream archive re-signed and repacked (llama.cpp). The repacks of EmbeddingGemma 2, PP-OCRv5 and Beat
  This! reproduce the hosted bytes from upstream exactly; signed binaries differ on every build (the signature's
  timestamp), so `--rebuild <id>` needs a new version. `--only <id,…>` builds a few.
  `pack-transnetv2-coreml.sh` also needs `TAALCUT_IXV1_FOOTAGE` (the ix-v1 footage folder) for its parity gate.
- **Signing policy.** Every Mach-O in a component carries Taalcut's Developer ID (team WW382UC8JD) with the
  hardened runtime, a secure timestamp and no entitlement but the ones its plan allows by path (only the headless
  shell's `allow-jit`). Deno keeps Deno Land's own Developer ID signature and notarisation (team 2H4KBF436B). Model
  and data components may hold no Mach-O at all.
- **Notarisation.** `notarize.mjs` unpacks each Taalcut-signed component as the app installs it, zips it with
  `ditto` and submits it with `notarytool --wait`; the verdict is the JSON's `status`, never the exit code, and the
  submission's log must list no issues and a ticket for every Mach-O file. A bare executable or an archive can't
  carry a stapled ticket: Gatekeeper finds it online by each file's code directory hash (`spctl -a -t install`
  says `source=Notarized Developer ID`). It is tested with notarytool stubbed at the process boundary.
- **Upload** skips an object R2 already holds with the same sha256 (its `x-amz-meta-sha256`), refuses one that holds
  other bytes, sends files over 64 MB in parts (each part's sha256 signed, so R2 refuses any changed byte), and checks
  every object with a HEAD afterwards. Archives go up as `application/zstd` or `application/gzip`, everything else
  binary as `application/octet-stream` (sources as `application/x-xz`, `application/zip` or `application/gzip`),
  which Cloudflare never compresses, and notices as `text/plain`; all of them cached for a year as `immutable`. It
  only adds objects to the one bucket. The zone's cache rule caches files up to 512 MB at the edge; larger ones are
  served from R2 on every request.
- **Verify** must pass for every url before the manifest is merged. Run it a few minutes after the last upload: the
  edge caches a 404 on `.bin` and `.tar.zst` keys for about 3 minutes, so a request that raced the upload can still
  answer 404 until then.
- **The manifest** is bundled with the app (`Contents/Resources/manifest.signed.json`); the app fetches no manifest.

## Linux builds

The linux-x64 builds (LNX1-CMP) are built on a Linux host and **hosted since 2026-10-28** (signed manifest sequence
18). They live in `manifest.linux.provisional.json`, one of the `SOURCES`: `components` (the components only Linux has)
and `extend` (per existing id, the linux-x64 artifact to add and the fields to set: `variants`, `requires`, the
licence with its new notice). Their plans are `hosting/plan/linux.mjs` (`LINUX`, the Linux-only components;
`LINUX_X64`, the `platforms['linux-x64']` entry merged into an existing plan) and vision's `VISION_LINUX`, all in `PLAN`.

A component with several platforms' artifacts has one notice naming every hosted URL and one release record per
artifact. `build.mjs --platform linux-x64,any` builds only those platforms' artifacts and takes the others from their
hosted URL (checked by size and sha256, the codesign policy left to the host that built them).

```sh
# Build on the Linux host (no Developer ID needed: nothing holds a Mach-O). The CUDA whisper-server builds in Docker,
# capped (tools/whisper/build-linux.sh). Big files: point --out and TAALCUT_COMPONENTS_CACHE at a roomy volume.
node tools/components/hosting/build.mjs --platform linux-x64,any --out <release dir>
# Then the release steps above from step 3: upload (against <release dir>/release.json), write-manifest
# (--release <release dir>/release.json), sign the next sequence, verify. Check what a machine picks:
pnpm --filter @taalcut/jobs exec vitest run test/linux-manifest.test.ts
```

A new platform's builds can wait in a file listed in `compose-provisional.mjs`'s `PENDING` (and their plans in
`PENDING_PLAN`) until they are hosted: `build.mjs --pending` and `write-manifest.mjs --pending` work on them while
`manifest.provisional.json` and the signed manifest stay exactly what is hosted. The linux-x64 builds waited that
way (`linux/pending.json`) from LNX1 until UX3 hosted them.

The pack scripts check what they pack: every ELF file's newest glibc symbol (2.35 at most for what Taalcut builds, so
Ubuntu 22.04 runs it; upstream llama.cpp's CUDA build needs 2.38 and says so in `requires.minGlibc`), no RPATH or
RUNPATH outside the component, and the NVIDIA archives against the sha256 in NVIDIA's redistrib JSON. The CUDA runtime and
whisper builds carry a `BUILDINFO.json` with their pins and tool versions. The llama.cpp Linux builds link the system's `libssl3`,
`libgomp1` and (Vulkan) `libvulkan1`, which the Linux package must depend on.

## Resumable component downloads

`download-worker/` serves only `components.taalcut.app/*` from the existing R2 bucket. It streams GET/HEAD and
single byte ranges without buffering the artifact. This preserves resumable downloads for models larger than the
public R2 domain's cacheable limit. Existing content types, immutable caching, ETags and lack of browser CORS grants
are preserved. The canary and production route passed full-download and resumed SHA-256 checks on 2026-11-11;
all 48 production artifact URLs passed header/range probes. The conditional-request contract is in the worker's
source and tests. The deployed configuration is `download-worker/wrangler.jsonc`.

## The workspace shell's toolchain

The agent's workspace shell (packages/tools SPEC, "Workspace shell") runs Node, Python and the HyperFrames CLI from
three components, hosted since 2026-11-11 (`manifest.workspace.provisional.json`,
`hosting/plan/workspace.mjs`, signed manifest sequence 21). `workspace/pins.mjs` pins every source; `workspace/pack.mjs` builds one, and the
hosting build's script recipe runs it with the Developer ID:

```sh
node tools/components/workspace/pack.mjs --component workspace-node|workspace-python|hyperframes-cli --out <dir>
```

- `workspace-node`: nodejs.org's tarball reduced to `bin/node` and `LICENSE` (no npm, npx or corepack), never
  re-signed; the build checks the Node.js Foundation's signature (team HX7739G8FX).
- `workspace-python`: the reference fetcher's CPython with the reviewed wheels installed by its own pip, offline and
  `--no-deps`, then pip removed and every module compiled with `--invalidation-mode unchecked-hash`. A wheel library
  its review (`bundles`) doesn't name, or a copyleft licence in PYTHON.json, fails the build. Held wheels and why:
  `HELD_WHEELS`.
- `hyperframes-cli`: the npm tarballs `workspace/hyperframes-cli.lock.json` pins, unpacked where npm would put them
  (no npm, no install scripts), shims in `bin/` that preload `lib/taalcut-loopback.cjs`, and LICENSES/. Optional
  dependencies stay out but esbuild's executable. Bumping the CLI: an npm lock of `hyperframes@<version>` in an empty
  folder (`npm install --package-lock-only --ignore-scripts`), then `node tools/components/workspace/cli-lock.mjs
  refresh <package-lock.json>`, which checks each tarball against npm's integrity and every licence.

The production manifest installs these without developer overrides. Python's 55 Mach-O files and the CLI's
esbuild executable were notarised with `taalcut-notary`; Node preserves the OpenJS Foundation's signing and
notarisation. All six artifact/notice objects are public and immutable. `workspace/dev-release.mjs --out <dir>`
still builds a separate development bundle for `TAALCUT_DEV_COMPONENTS=<dir>`; do not write its ad hoc signatures
over the hosted manifest. `TAALCUT_SHELL_TOOLCHAIN_DIR` (a folder with the three unpacked) runs packages/tools'
`workspace-shell-toolchain.test.ts`.

## The reference fetcher

`reference-fetcher` is yt-dlp built by Taalcut from its tagged source, the way upstream builds its own macOS
release, with nothing taken from upstream's prebuilt executables. `yt-dlp/pack.mjs` (build.mjs's `script` recipe):

1. unpacks python-build-standalone's relocatable CPython (arm64; its `PYTHON.json` lists every C library it links,
   and the build refuses a copyleft one) and yt-dlp's tagged source;
2. installs upstream's hash-locked requirements (`bundle/requirements/pip.txt`, `macos.txt`, `macos-curl_cffi.txt`)
   into a venv with `--require-hashes`, wheels only;
3. sets `VARIANT` and `UPDATE_HINT` in `yt_dlp/version.py` (Taalcut updates yt-dlp with the app, so `-U` only says
   so), makes the lazy extractors and runs `python -m bundle.pyinstaller --onedir --name=yt-dlp`;
4. inventories every collected file by distribution (`inventory.py`, `inventory.mjs`) against the reviewed licence
   table in `pins.mjs`, writes `LICENSES/` (each piece's licence files and `INVENTORY.txt`), and fails on a
   distribution it hasn't reviewed, one whose declared licence changed, or a copyleft piece whose source isn't pinned;
5. signs every Mach-O with the Developer ID (hardened runtime, secure timestamp, no entitlements: the onedir loads
   its Python from `_internal/`, signed by the same team, so library validation passes), verifies them, and runs the
   build: `--version`, an extraction from a page served on 127.0.0.1, and the same under the fetcher's sandbox
   profile with the parameters the app passes;
6. packs it as `yt-dlp-<version>-darwin-arm64.tar.zst` (`yt-dlp`, `_internal/`, `LICENSES/` at the top,
   `stripComponents` 0); the app runs `<component>/yt-dlp`.

**Pinned now** (`yt-dlp/pins.mjs`): yt-dlp 2026.10.21 (tag commit `6ccd9773`, GitHub's archive of it, 3140619 bytes),
CPython 3.14.9 from python-build-standalone 20261021 (the series upstream's macOS release runs on), and the sdists of
the copyleft pieces upstream's lock names: certifi 2026.10.19, mutagen 1.48.1 and PyInstaller 6.22.0.

**Bumping it.** Stable yt-dlp goes stale within weeks, as sites change; bump it whenever a stable tag lands:

1. Find the newest stable tag (the latest GitHub release, not a nightly) and its commit:
   `git ls-remote https://github.com/yt-dlp/yt-dlp refs/tags/<tag>`.
2. Download `https://codeload.github.com/yt-dlp/yt-dlp/tar.gz/<commit>` twice; the two sha256 must match. Set
   `YT_DLP` (version, commit, url, size, sha256).
3. In the new tag's `bundle/requirements/*.txt`, look up certifi, mutagen and pyinstaller (and any distribution
   reviewed as copyleft). Set `COPYLEFT_SOURCES` to each one's PyPI sdist (`https://pypi.org/pypi/<name>/<version>/json`
   lists its url, size and sha256); the build refuses an sdist whose sha256 isn't one the lock names.
4. If upstream's release moved to another Python series (`bundle/pyinstaller.py` and its release workflow), pin the
   matching python-build-standalone release in `PYTHON` (`install_only_stripped` and `pgo+lto-full` for
   aarch64-apple-darwin).
5. Set the new `version` in `manifest.reference-fetcher.provisional.json` (a new key: hosted keys never change) and
   run the release with `build.mjs --only reference-fetcher`, then `notarize.mjs`, `upload.mjs`, `write-manifest.mjs`
   and the rest. A build that stops on the licence inventory names the distribution: review its licence and record
   it in `DISTRIBUTIONS` (pin its sdist too if it is copyleft).
6. Record the new build-scripts tarball (`source/taalcut-yt-dlp-build-<version>.tar.zst`) in
   `hosting/plan/hosted.mjs`.

## Deno's notice

Deno links some 730 Rust crates, V8 and the Rust standard library, so its notice is generated rather than written:
`deno/notice.mjs` reads the pinned release's own source and lock, and fetches only pinned bytes at build time.

- **Crates:** `cargo tree -p deno --target aarch64-apple-darwin -e normal,no-proc-macro --locked --offline` on deno's
  tagged source (`DENO` in `deno/pins.mjs`: GitHub's archive of the tag commit, by sha256), with crates.io's packages
  fetched by the lock's checksums into `tools/components/.cache/cargo-home`. Each crate is quoted with its own licence
  files; Deno's own path crates with the workspace's `LICENSE.md` and every licence file inside them.
- **Native code:** a crate with a `links` key or a `cc`/`cmake` build dependency compiles C or C++ in. `NATIVE` names,
  for each, why and the licence files of what it compiles in (aws-lc, zlib-ng, libffi, SQLite, zstd, ...).
- **V8:** the v8 crate links rusty_v8's prebuilt static library. `V8_FILES` lists the licence files of V8, rusty_v8
  and every library V8 compiles in with rusty_v8's build arguments for macOS arm64 (abseil, ICU, highway, simdutf,
  libc++, glibc's sin and cos under the LGPL-2.1-or-later, ...), at the commits rusty_v8 pins; `gn.mjs` follows the
  v8 crate's `BUILD.gn` files to the Rust crates of V8's Temporal support, quoted from their `.crate` files.
- **The Rust standard library** of Deno's toolchain, from rustup's `rust-src` (`cargo tree -p std --features backtrace,panic-unwind`).
- **Deno's own source:** every first comment naming a copyright holder other than the Deno authors (Node.js,
  TypeScript, type definitions, ...) is quoted as it stands, with the files it heads and the licence texts it refers
  to (`EMBEDDED` maps a holder to texts; an MIT notice gets the MIT text).

Identical texts are quoted once and numbered, and each crate lists its numbers (about 470 texts, 1.6 MB). Where a
crate publishes no licence file, `licences.json` pins its repository's (at the commit crates.io records, else the
version's tag, else the default branch), or records that it has none either; the notice then quotes the text its
`Cargo.toml` declares and says so. The build stops on anything nobody has reviewed: a native crate `NATIVE` doesn't
name (or one it names that deno no longer links), a crate with no licence file and no entry in `licences.json` (or an
entry for a crate that is gone), a V8 commit or Temporal crate list `licences.json` doesn't have, and a copyright
holder `EMBEDDED` doesn't know.

**Bumping Deno:**

1. Set `DENO` in `deno/pins.mjs`: the tag's commit, its codeload archive (download it twice; the two sha256 must
   match) and the toolchain its `rust-toolchain.toml` names; `rustup toolchain install <it> --component rust-src`.
2. In `hosting/plan/tools.mjs`, pin npm's `@deno/darwin-arm64` tarball and, under `sources`, the v8 crate and the
   MPL-2.0 crates the new `Cargo.lock` names (by its checksums).
3. `GITHUB_TOKEN=$(gh auth token) node tools/components/deno/discover.mjs` rewrites `licences.json` (it reads the
   GitHub API, which rate-limits an unauthenticated run). Review its diff.
4. Run `build.mjs --only deno`. When it stops, review what it names: a native crate's compiled-in code into `NATIVE`,
   a copyright holder into `EMBEDDED`, a library V8 now compiles in into `V8_FILES` (rusty_v8's `.gn` arguments and
   V8's `BUILD.gn` say what macOS arm64 builds), then run discover.mjs again.
5. Check the copyleft paragraph in `plan/tools.mjs` against the notice (`grep -nE 'MPL|LGPL|GPL'` on its index).
