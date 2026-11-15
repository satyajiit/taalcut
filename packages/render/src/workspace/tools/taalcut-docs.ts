// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Supplemental Taalcut motion-design reference topics served by `workspace.docs` (WP-HFW-3D-CDP):
 * - `taalcut/three-3d`: Deterministic GSAP ↔ Three.js 3D WebGL scene authoring
 * - `taalcut/choreography`: Frame-accurate beat choreography & spring/stagger timing principles
 * - `taalcut/impeccable-craft`: Anti-slop visual craft, typographic hierarchy, and safe-zone rules
 * - `taalcut/sandbox-workspace`: Workspace file management, sandbox shell (`work/`, `inputs/`, `out/`), and CLI tools
 * - `taalcut/design-options` (DSG2, design-options-guide.ts): the method for a job's three options
 * - `taalcut/hallmark-thumbnails` (CVR2, cover-docs.ts): what a strong cover is
 */
import { HALLMARK_THUMBNAILS_DOC } from './cover-docs';
import { DESIGN_OPTIONS_DOC } from './design-options-guide';
import type { TaalcutDocsTopic } from './taalcut-docs-topic';

export type { TaalcutDocsTopic } from './taalcut-docs-topic';

export const TAALCUT_DOCS_TOPICS: readonly TaalcutDocsTopic[] = [
  {
    topic: 'taalcut/three-3d',
    text: `# Deterministic Three.js 3D in HyperFrames (GSAP Bridge)

## Core Contract
- Never call \`requestAnimationFrame\` or \`THREE.Clock.getDelta()\` inside a Taalcut composition.
- Every 3D scene must be driven by \`window.__timelines[compositionId]\` and rendered synchronously on \`hf-seek\`.
- Always create \`THREE.WebGLRenderer\` with \`{ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }\` so headless frame capture reads the drawn framebuffer.
- Seed procedural geometry or particle positions with \`window.__tcThreeCreateRng(seed)\` (\`mulberry32\`), never \`Math.random()\`.

## Using \`window.__tcThreeBindScene\`
1. Place a \`<canvas data-tc-three="hero-3d" data-composition-id="comp" width="1080" height="1920"></canvas>\` inside your composition root.
2. Call \`window.__tcThreeBindScene(canvas, spec, window.THREE)\` or tween plain numeric proxy objects on your paused GSAP timeline with \`onUpdate: renderNow\`.
3. Verify determinism and zero WebGL errors using \`workspace.render\` / \`workspace.renderOver\` (\`seekDeterminism: 'pass'\`, \`runtimeErrors: 'pass'\`).
`,
  },
  {
    topic: 'taalcut/choreography',
    text: `# Beat Choreography & Motion Timing Principles

## 1. Entrance, Hold, and Exit Cadence
- **Entrance (12–20% of clip duration, 0.35s–0.65s):** Lead with \`power3.out\` or \`expo.out\`. Stagger words by \`0.025s–0.045s\` or cards by \`0.08s–0.14s\`.
- **Reading Hold (60–75% of clip duration):** Keep text legible and stable; subtle secondary motion (\`±4px\` drift or SVG underline draw) must never fight eye tracking.
- **Exit (10–15% of clip duration, 0.25s–0.45s):** Accelerate out with \`power2.in\` before the cut so the outgoing graphic clears 2 frames before the beat transition.

## 2. Sequenced Layering (No Simultaneous Mud)
- Never start headline, subhead, badge, and background plate on the exact same frame.
- Offset plate → headline (\`+0.08s\`) → accent/underline (\`+0.18s\`) → subhead (\`+0.24s\`).
- Always register named labels (\`tl.addLabel('enter', 0)\`, \`tl.addLabel('peak', 0.8)\`, \`tl.addLabel('exit', duration - 0.5)\`) so edits stay semantic.
`,
  },
  {
    topic: 'taalcut/impeccable-craft',
    text: `# Impeccable Visual Craft & Anti-Slop Rules for Video Overlays

## 1. Copy Density Ceiling
- At most **6 lines of visible text** per frame (\`impeccableCraft\` gate check).
- Short-form vertical video (1080×1920) is scanned in under 1.8 seconds; split dense copy across sequential beat cards instead of shrinking font sizes.

## 2. Decisive Typographic Hierarchy
- When combining a primary headline and secondary subhead/role on the same frame, maintain a scale ratio of **at least 1.18×** (e.g., \`64px\` headline over \`40px\` role = \`1.60×\`, or \`96px\` display over \`48px\` kicker = \`2.00×\`).
- Avoid the muddied \`1.04×–1.17×\` band where two distinct text roles look like an accidental mismatch.

## 3. Card Breathing Room, Open-Air Legibility & Symmetric Centering
- Painted cards (\`background-color\` behind text) must keep **at least 16–24 px inner padding** on all sides (hard gate floor: \`8 px\`), and maintain WCAG AA contrast (\`≥ 4.5:1\`).
- **Avoid generic dark slabs over footage:** Do not default to heavy opaque dark (\`#101a20\` / \`rgba(0,0,0,0.85)\`) rectangular boxes behind titles or location tags over scenic photography. Prefer open display typography with multi-layered optical \`text-shadow\` (\`0 2px 6px rgba(0,0,0,0.65), 0 10px 32px rgba(0,0,0,0.5)\`), warm editorial paper pills (\`#fff8ec\` with dark ink), or a clean kicker + accent rule lockup.
- **Symmetric canvas centering:** On a \`1080×1920\` canvas, horizontal center is \`x = 540 px\`. For centered titles or hooks, use a full-width symmetric flex container (\`left: 70px; width: 940px; display: flex; flex-direction: column; align-items: center; text-align: center;\`) so single-line hooks stay on 1–2 lines and center at \`x = 540 px\`. Never offset centered titles to \`left: 120px; width: 660px\` or squeeze them into a narrow \`480px\` column.
`,
  },
  {
    topic: 'taalcut/sandbox-workspace',
    text: `# Taalcut Workspace & Sandbox Shell Capabilities

## 1. Workspace File Management Tools
Manage project composition files directly in the revisioned workspace head (every write dispatches \`workspace.writeFiles\`, creating an undoable revision):
- \`workspace.list\`: Lists all files in the workspace head and refreshes \`_taalcut/brief.md\` when \`timelineId\` is passed.
- \`workspace.read\`: Reads any UTF-8 file in the workspace (defaulting to \`_taalcut/brief.md\`). Once \`_taalcut/brief.md\` has been listed or read with \`timelineId\`, it is persisted in the workspace store so subsequent reads and shell commands can read it directly.
- \`workspace.new\`: Scaffolds a blank, gate-passing HyperFrames sub-composition (\`<name>/index.html\`).
- \`workspace.write\`: Writes or creates a full UTF-8 file in the workspace head.
- \`workspace.patch\`: Applies exact find/replace edits to an existing UTF-8 workspace file.
- \`workspace.delete\`: Deletes one or more workspace files atomically from the workspace head.
- \`workspace.move\`: Moves, renames, or copies (\`copy: true\`) a workspace file atomically (with \`overwrite: false\` protection).
- \`workspace.search\`: Searches across all UTF-8 workspace files and \`_taalcut/brief.md\` by substring or regular expression (\`regex: true\`), with optional \`pathPrefix\` and \`caseSensitive\` filtering.
- Revision history & recovery: Every workspace mutation records an atomic revision and supports full undo/redo on the command bus, or restoring prior file contents cleanly.

## 2. Sandbox Shell & File Bridge (\`workspace.open\`, \`workspace.exec\`, \`workspace.files\`, \`workspace.importMedia\`)
When you need to run CLI tools, generate procedural assets, or render full standalone video/audio clips:
- \`workspace.open\`: Opens (or refreshes) the project's isolated sandbox directory via \`workspace.open({ projectId, inputs })\` and stages any requested library \`inputs\` into \`inputs/\`.
- \`workspace.exec\`: Runs a command inside \`work/\` (\`cwd\` is \`work/\`, so staged inputs are at \`../inputs/<assetId>.<ext>\` and outputs go to \`../out/<file>\`).
- \`workspace.files\`: Lists or reads files across the three sandbox scopes (\`work\`, \`inputs\`, \`out\`).
- \`workspace.importMedia\`: Imports a rendered file from \`out/<path>\` into the project library as a media asset ready for \`timeline.insertClip\` or \`timeline.swapClip\`.

### The Three Sandbox Scopes (\`work/\`, \`inputs/\`, \`out/\`)
- \`work/\`: Checked out automatically from the workspace head before every \`workspace.exec\` call, and any UTF-8 files or \`assets/<sha256>\` created, edited, or deleted in \`work/\` are automatically synced back into the workspace head after \`workspace.exec\` finishes! \`_taalcut/brief.md\` is available on disk at \`work/_taalcut/brief.md\` once read or listed with \`timelineId\`.
- \`inputs/\`: Read-only staged library media files requested via \`workspace.open({ projectId, inputs })\` (referenced from \`workspace.exec\` as \`../inputs/<assetId>.<ext>\`).
- \`out/\`: Scratch output directory for rendered MP4/WAV/PNG media (referenced from \`workspace.exec\` as \`../out/<file>\`); import finished outputs into the library/timeline with \`workspace.importMedia\`.

## 3. Sandbox CLI Tools on \`PATH\`
Inside \`workspace.exec\`, the sandbox environment provides:
- \`node\`: Node.js runtime for procedural SVG/HTML/JSON generation or build scripts.
- \`python3\`: Python 3 runtime for data processing, math, or procedural asset scripts.
- \`hyperframes\`: Bundled HyperFrames CLI (\`hyperframes render\`, \`hyperframes lint\`, etc.).
- \`ffmpeg\` / \`ffprobe\`: Bundled LGPL FFmpeg & FFprobe. Choose a supported GPU encoder first, such as VideoToolbox on macOS. If hardware encoding fails, use VideoToolbox with \`-require_sw 1\` on macOS (libopenh264 on Linux) and record the CPU fallback reason; libx264 and drawtext (libfreetype) are not bundled, so build contact sheets with \`-vf "fps=...,scale=...,tile=..."\` without \`drawtext\` (or add labels with \`python3\` Pillow).
- \`chrome-headless-shell\`: Bundled headless Chromium for deterministic DOM/WebGL capture (always pass \`--no-sandbox\` when invoking directly inside Seatbelt).
`,
  },
];

/** CVR2: the cover craft guide, with the route beside it (cover-docs.ts). */
export { HALLMARK_THUMBNAILS_DOC };

export const TONE_AUDIO_DOC: TaalcutDocsTopic = {
  topic: 'taalcut/tone-audio',
  text: `# Deterministic Tone.js & Procedural Audio in HyperFrames (GSAP Bridge)

## Core Contract
- Bind procedural audio cues to \`window.__timelines[compositionId]\` using \`window.__tcToneBindScene(spec, window.Tone)\` so audio cues stay locked to \`hf-seek\` and GSAP labels (\`enter\`, \`peak\`, \`exit\`).
- Offline export synthesizes \`ToneSceneSpec\` cues deterministically at 48 kHz (\`renderToneScenePcm\`) and mixes them into the SFX bus with ITU-R BS.1770-4 loudness normalization.
`,
};

export const TAALCUT_DOCS: readonly TaalcutDocsTopic[] = [
  ...TAALCUT_DOCS_TOPICS,
  DESIGN_OPTIONS_DOC,
  HALLMARK_THUMBNAILS_DOC,
  TONE_AUDIO_DOC,
];

export const TAALCUT_DOCS_ALIASES: Readonly<Record<string, string>> = {
  'taalcut/impeccable-motion': 'taalcut/impeccable-craft',
  'taalcut/hallmark-design': 'taalcut/hallmark-thumbnails',
};

export function resolveTaalcutDocTopic(topic: string): string {
  return TAALCUT_DOCS_ALIASES[topic] ?? topic;
}
