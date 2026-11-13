# Audio packs

The small bundled packs `@taalcut/audio` places on a timeline (packages/audio SPEC P3.5 and P3.6), built here into
**components** (`tools/components`), never committed: the sounds and tracks live in `packages/audio/.cache/packs/`
(gitignored) and reach users through the component manager, checksummed.

| File                            | What it is                                                                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build-sfx-pack.mjs`            | Builds the `sfx-pack` component: every recipe rendered with the bundled FFmpeg, measured, catalogued, packed. Prints the archive's sha256, size and extractedSize                         |
| `sfx-sounds.mjs`                | The 32 sounds (8 each of `whoosh`, `riser`, `impact`, `hit`: core's `SFX_CATEGORIES`) and their fixed seeds and numbers                                                                   |
| `sfx-recipes.mjs`               | One builder per category: a few numbers → an FFmpeg filter graph over FFmpeg's own seeded noise and expression oscillators                                                                |
| `sound-files.mjs`               | One sound: render, peak-normalise to −1 dBFS, 16-bit FLAC bit-exact, then measure it the way audio's `measureSoundShape` does (length, peak, momentary-max loudness)                      |
| `pack-archive.mjs`              | A reproducible archive: a ustar written in Node (names sorted, mode 0644, uid/gid 0, mtime 0, no macOS metadata) compressed with zstd 19 through Node's zlib                              |
| `CC0-sfx-pack.txt`              | The licence record shipped in the pack as `LICENCE.txt`: the contributors' CC0 1.0 dedication of the synthesised sounds, then the CC0 legal code as Creative Commons publishes it         |
| `build-music-pack.mjs`          | Builds the `music-pack` component from `music-tracks.json`: each track copied byte for byte with its own licence text, its length probed, `catalogue.json` written. Refuses an empty list |
| `music-tracks.json`             | The music pack's track list. **Empty until the product owner picks the tracks**                                                                                                           |
| `build-interface-sounds.mjs`    | Finishes Tone's offline WAVs into seven measured AAC interface cues                                                                                                                       |
| `generate-interface-sounds.mjs` | Node authoring orchestration: bundles the browser entry, renders Tone offline and writes finished cues and provenance                                                                     |
| `interface-sounds.json`         | The interface cues' notes, durations, Tone version, sample rate and loudness targets                                                                                                      |
| `tone-interface-recipes.mjs`    | The soft sine envelopes used by the renderer's development-only Tone authoring harness                                                                                                    |

## The sound pack (`sfx-pack`)

```sh
node tools/audio-packs/build-sfx-pack.mjs
```

Writes `packages/audio/.cache/packs/sfx-pack/` (32 FLAC files, `catalogue.json`, `LICENCE.txt`) and
`packages/audio/.cache/packs/sfx-pack-1.0.0.tar.zst`. Options: `--out <dir>`, `--ffmpeg <path>` (default
`tools/ffmpeg/dist/ffmpeg`, or `TAALCUT_FFMPEG`), `--only <id,id>`, `--no-archive`. It takes a few seconds; on a
machine shared with video work, run it under the same hardware-encoder lock as other FFmpeg work.

- **Licence.** Nothing in the pack is anyone else's recording: every sound is generated from FFmpeg's seeded noise
  sources and expression oscillators through its filters, so the Taalcut contributors can and do dedicate them to the
  public domain under CC0 1.0 (`CC0-sfx-pack.txt`). The catalogue's `source` for each sound points here. Third-party
  CC0 packs (Kenney, individual Freesound CC0 sounds; SPEC P3.6) can replace or join them once the product owner has
  approved the sounds and their licence files were read; Sonniss GDC, BBC RemArc and the YouTube Audio Library never.
- **Format.** FLAC 48 kHz mono 16-bit, not the Opus the SPEC planned: the shipped LGPL FFmpeg has no libopus, and its
  native Opus encoder is experimental. The whole pack is about 2 MB.
- **Peaks.** `peakMs` is the instant the hit planner lands on the cut: for a whoosh, its loudest sample (the swell);
  for an impact or a hit, the loudest sample in its first 40 ms (its attack, before any echo); for a riser, its end.
  `loudnessLufs` is the momentary-max loudness (ebur128 M, with 400 ms of silence appended so short sounds get whole
  windows); the planner levels each sound under the music bed from it.
- **Reproducible.** Fixed seeds, bit-exact FLAC, no metadata, the archive written by `pack-archive.mjs`: two builds
  give the same sha256, which is what `tools/components/manifest.voice-music.provisional.json` records. Change a recipe
  and the sha256 changes: bump `SFX_PACK_VERSION`, rebuild, update the manifest entry, then compose and re-sign
  (`tools/components/README.md`).
- **Human input.** The product owner listens to the 32 sounds and approves them (or asks for changes) before release.

## The music pack (`music-pack`)

No music API is clean for an app that lets users export what it fetched (SPEC P3.5), so Taalcut bundles a few
**CC0-1.0** tracks. The product owner picks them; until then `music-tracks.json` is empty, no component exists, and
the app hides the option (`audio.music_library_empty`).

To build it: download each track and save its page's licence or dedication text beside it, list them in
`music-tracks.json` (`id`, `title`, `file`, `licenceFile`, `bpm`, `moods`, `sourceUrl`, `dedicationUrl`, optional
`attribution`), then

```sh
node tools/audio-packs/build-music-pack.mjs --from <folder with the files>
```

It refuses a track whose licence file doesn't say CC0, copies every file byte for byte (no re-encode), probes its
length, writes `catalogue.json` and `packages/audio/.cache/packs/music-pack-<version>.tar.zst`, and prints the
manifest numbers. Add a `music-pack` entry to `tools/components/manifest.voice-music.provisional.json` with them.
Beats are not tracked here: the timeline tracks a library track's beats when it is first chosen and caches them.

## Interface sounds

The renderer ships seven short, soft interface cues, around 23 KB together. Their `.m4a` assets and measured
`provenance.json` are committed in `apps/renderer/src/features/sounds/assets/`. Tone.js 15.1.22 is a renderer
**development dependency only**: the app plays the bundled files with HTML audio and does not load Tone.

```sh
pnpm --filter @taalcut/renderer sounds:build
# A verification build can write elsewhere without changing the committed assets:
pnpm --filter @taalcut/renderer sounds:build --out /tmp/taalcut-interface-sounds
```

| Cue              | Notes        | Duration, including release | Target   |
| ---------------- | ------------ | --------------------------- | -------- |
| `promptSent`     | C5           | 100 ms                      | −28 LUFS |
| `editApplied`    | E5           | 140 ms                      | −28 LUFS |
| `undo`           | E5 → C5      | 160 ms                      | −28 LUFS |
| `redo`           | C5 → E5      | 160 ms                      | −28 LUFS |
| `importDone`     | G4 → C5      | 280 ms                      | −22 LUFS |
| `draftAssembled` | C5 → G5      | 360 ms                      | −22 LUFS |
| `complete`       | C5 → E5 → G5 | 480 ms                      | −22 LUFS |

- **Authoring.** `tools/audio-packs/generate-interface-sounds.mjs` uses the existing Vite and Playwright
  development tools to bundle the authoring entry and run `Tone.Offline` in Chromium at 48 kHz mono. Its CPU
  fallback is logged because OfflineAudioContext has no GPU synthesis backend. No samples, model service,
  network access, or installed end-user tools are needed. Developers use the repository's bundled FFmpeg
  and Playwright Chromium (`pnpm --filter @taalcut/renderer e2e:install` if missing). The Node process
  resolves these pinned development dependencies from the renderer package; its browser entry remains
  `apps/renderer/scripts/interface-sounds-browser.mjs`, with no Node imports.
- **Sound.** Sine notes with a low-pass filter, short smooth attacks and exponential releases; no noise,
  randomization, reverb or long tails. The source recipes and sounds are original Taalcut work under the
  repository's AGPL licence; Tone itself is MIT. Setup steps reuse `editApplied`, setup completion reuses
  `complete`, and imports use `importDone` once per completed batch. There is no per-file ping.
- **Finish.** A 100 Hz high-pass and quarter-sine fade precede loudness adjustment. The encoded result targets
  the table's LUFS or a −3 dBTP true-peak ceiling, whichever is quieter. Measurement uses BS.1770 with 400 ms
  of trailing silence. AAC-LC is 96 kbit/s mono at 48 kHz, bit-exact without metadata. Runtime volume 0.6
  lowers it a further 4.4 dB. Short milestones can land below their LUFS target to preserve the peak ceiling.
- **Verification.** The builder rejects silent/non-finite PCM, unexpected lengths and a true peak above the
  ceiling. Provenance records the Tone/Chromium/FFmpeg versions, recipe and manifest hashes, PCM hashes,
  encoded file hashes and measured levels. Rebuilding twice with the same tool versions produces identical
  PCM and AAC hashes; compare provenance after intentionally changing a recipe or upgrading the authoring
  browser. Speaker and headphone listening remains a manual sound-quality check.
