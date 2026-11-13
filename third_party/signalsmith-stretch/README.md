# signalsmith-stretch

Upstream: <https://github.com/Signalsmith-Audio/signalsmith-stretch>, the official JS/WebAssembly release on npm,
`signalsmith-stretch@1.3.2`, built from commit `222093b4cc13ddb4d07c826bc3c1559326091731` (the npm `gitHead`; the
library header reports version `{1, 3, 2}`).

`LICENSE.txt` is Signalsmith Stretch's MIT licence (copyright (c) 2022 Geraint Luff / Signalsmith Audio Ltd.);
`LICENSE-signalsmith-linear.txt` is the MIT licence of Signalsmith Linear (copyright (c) 2025 Signalsmith Audio), which
Stretch includes for its STFT, so the WebAssembly build contains it. Both are kept with the code
(`_orch/p3/research/audio-mixing.md`, "Signalsmith Stretch — use this").

## How Taalcut uses it

`@taalcut/audio` stretches generated music onto a template's beat map bar by bar (ratios 0.85–1.15) and compresses a
voice line by at most 8 % (`packages/audio/SPEC.md` P3.4, P3.5). It runs offline in a utility process, so it uses the
module's C entry points directly (`_presetDefault`, `_setBuffers`, `_seek`, `_process`, `_flush`, the two latencies)
instead of the npm build's Web Audio worklet node.

Rubber Band is never used: it is GPL-2.0-or-later, and `--enable-librubberband` would turn the shipped FFmpeg GPL.

## Files

- `upstream/SignalsmithStretch.mjs`, `upstream/package.json`: the npm tarball's files, unchanged.
- `src/signalsmith-stretch.mjs`: the Emscripten module factory, cut from the upstream file unchanged (lines 3–16),
  plus a default export. The WebAssembly binary is inlined in it as base64; nothing is fetched at run time.
- `src/signalsmith-stretch.d.mts`: types for the C entry points.

pnpm copies this package into `node_modules`; after editing anything in `src/` run `pnpm install --frozen-lockfile`.
