// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Supplemental Taalcut motion-design reference topics served by `workspace.docs` (WP-HFW-3D-CDP):
 * - `taalcut/three-3d`: Deterministic GSAP ↔ Three.js 3D WebGL scene authoring
 * - `taalcut/choreography`: Frame-accurate beat choreography & spring/stagger timing principles
 * - `taalcut/impeccable-craft`: Anti-slop visual craft, typographic hierarchy, and safe-zone rules
 * - `taalcut/sandbox-workspace`: Workspace file management, sandbox shell (`work/`, `inputs/`, `out/`), and CLI tools
 */

export interface TaalcutDocsTopic {
  readonly topic: string;
  readonly text: string;
}

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

export const HALLMARK_THUMBNAILS_DOC: TaalcutDocsTopic = {
  topic: 'taalcut/hallmark-thumbnails',
  text: `# Hallmark Video Covers & Social Publishing Pack

## 0. Follow the Brief's Medium and Composition
- Let the brief choose photography, illustration, graphic artwork or a mixed composition. Read supplied references and preserve their defining hierarchy, accents, illustration and branding. Do not automatically choose footage or a stock photo treatment.
- For new imagery, use \`images.generateThumbnail\` with the requested \`medium\`. Supported connected ChatGPT/Grok subscriptions and image API providers are eligible. Default \`composition: "backdrop"\` leaves lettering editable; use \`"complete"\` for an explicitly requested entirely generated composition with lettering and supplied branding. Do not overlay the same words again on a complete composition.
- Existing footage is appropriate when the brief calls for it: inspect candidate frames with \`timeline.captureFrame\` and pass \`source: {kind:"frame",frame:<seconds>}\` directly to \`timeline.setCover\` (never use \`workspace.open\` or \`ffmpeg\` in \`workspace.exec\` to extract a cover frame). Local graphic covers can use \`source: {kind:"solid"}\` with a design. Neither local route requires image-generation credentials.
- If generation is unavailable, explain the precise provider limitation and offer an alternative only if it still meets the requested medium. Do not silently substitute footage or tell an already signed-in person to repeat the same sign-in.

## Authored Graphic Covers: the Supported Design Contract
- Persist the finished design with \`timeline.setCover\`, then call \`render.exportCover\` at its returned revision. \`cover.design\` replaces preset title/badge overlays. Sources are \`{kind:"asset",assetId}\`, \`{kind:"frame",frame}\`, or \`{kind:"solid"}\` (requires design).
- Design: \`{version:1,palette:{ink,paper,accent,muted},layers:[...]}\`. Palette values are six-digit hex colors. Optional \`backdrop:{fit:"cover"|"contain",x:0.5,y:0.5}\` controls image crop and focal position. Contain preserves the entire supplied image; uncovered canvas uses paper.
- At most 16 ordered layers. Every layer has \`box:{x,y,width,height}\` in 0–1 canvas coordinates, with its box inside the canvas. Optional opacity 0–1 and rotation -180–180. Preserve the reference's intentional placements; crop guides inform review, they do not force all branding into a central square.
- Text layer: \`{kind:"text",text,font:"notoSans"|"poppins"|"montserrat"|"anton"|"bebasNeue",fontSize:0.16,weight:800,lineHeight:1.08,letterSpacing:-0.02,align:"left",color:"ink",box}\`. fontSize is 0.012–0.25 of the shorter canvas edge, tracking is em. Use newlines for deliberate hierarchy. Exact bundled fonts load before fitting. Long edits shrink within their box; inspect legibility after changes.
- Shape layer: \`{kind:"shape",shape:"rectangle"|"ellipse",fill:"accent",box}\`; optional stroke color role, strokeWidth 0–0.05 and radius 0–0.2 of the shorter canvas edge. Use a narrow rectangle (\`height: 0.006–0.01\`) for a precise accent underline or rule — **never place a heavy opaque \`fill:"ink"\` rectangular box behind headlines over a photo backdrop**. Over photography, place bold open display type (\`color:"paper"\` or \`"accent"\`) directly into clean negative space (sky, water, upper third, or natural shadow); Taalcut automatically renders optical depth shadow on light text over image backdrops.
- Path layer: \`{kind:"path",box,commands:[{command:"M",x:0,y:1},{command:"Q",cx:0.7,cy:0.8,x:1,y:0}],stroke:"paper",strokeWidth:0.01,dashed:true}\`. Coordinates are normalized within the layer box. At most 64 commands, starting M; M/L use x,y, Q adds cx,cy, C adds c1x,c1y,c2x,c2y, and Z closes. Fill/stroke use ink/paper/accent/muted/transparent. No raw SVG, scripts, external assets or arbitrary markup.
- Build a specific composition: oversized two-line upright headline, one intentional underline, a drawn flight path with a small plane silhouette, and supplied branding can all be separate editable layers over the chosen image. Do not apply this same structure to unrelated briefs.

## 1. Multi-Aspect Coverage & Platform Safe Zones
- **\`16:9\` (1920×1080 — YouTube):** Keep the bottom-right corner clear for the YouTube duration badge pill (\`0:42\`, \`12:18\`). Place the hero subject off-center on the right third and reserve low-detail tonal negative space in \`textAlign\` (\`left\`, \`top-left\`, or \`bottom-left\`).
- **\`9:16\` (1080×1920 — Shorts / Reels / TikTok):** Keep the right-rail action icon column and bottom caption zone uncluttered; ensure the central \`4:5\` profile grid crop stays balanced around the focal subject and hook.
- **\`4:5\` (1080×1350 — Instagram Feed) & \`1:1\` (1080×1080 — Profile Grid):** Frame the primary subject with clean margins so a center \`1:1\` square grid crop preserves both subject and headline hierarchy.

## 2. Hallmark Typography & Copy Restraint
- **Crisp Roman Display Hook (\`hookText\`):** 1–6 words maximum (\`<= 48\` chars). Prefer upright display type and preserve explicitly supplied punctuation; zero clickbait exclamation spam (\`!!!\`).
- **Optional Eyebrow Kicker (\`kickerText\`):** Short categorical context (\`<= 28\` chars, e.g. \`OLD CITY · DAWN\`).
- **Factual Stat Badge (\`statBadge\`):** Real timeline or production facts only (\`<= 20\` chars, e.g. \`14 SHOTS\`, \`4K RAW\`, \`DAY 2\`, \`0:42\`). Never invent fake engagement metrics (\`10M VIEWS\`, \`99.9%\`, \`100X\`).
- **Optional Channel Identity (\`channel\`):** Creator channel name, \`@handle\`, and optional avatar badge when \`showOnThumbnail: true\`.

## 3. Specific Art Direction
- Choose \`theme\` and \`archetype\` for the video's subject and mood. Change composition and hierarchy when changing archetypes; a color swap alone is not structural variety. Do not default every video to the same editorial layout.
- For generated imagery, describe the chosen visual medium and specific subject details relevant to the brief. Do not add film grain, shallow depth of field, cinematic glow or other stock effects unless they help this particular scene.
- Prefer editable exact lettering and branding; complete generated artwork may include them when requested. Avoid invented logos, unrequested watermarks, generic neon gradients, glowing sci-fi HUDs, plastic skin and stock poses.

## 4. Inspect the Finished Cover
- Open the saved cover asset returned by \`render.exportCover\` using \`library.frameAt\` at seconds 0; inspect the composed image, not just its prompt or backdrop. Check headline alignment, contrast, spelling, subject visibility, the intended crop and any secondary platform crops, and legibility at feed size.
- Self-critique Philosophy, Hierarchy, Execution, Specificity, Restraint and Variety from that visible result. Any axis below 3 needs revision and another export. Never invent visual scores before viewing the image; the thumbnail tool's brief checks are not a Hallmark visual pass.
- Only say the cover is saved after the current revision's JPEG export succeeds. If it cannot be completed, explain the exact remaining step. A selected frame, a generated backdrop, or a publish-pack preview alone is not a saved finished thumbnail.

## 5. Researched Social Publishing Metadata Pack (\`social\`)
- **YouTube:** High-CTR non-clickbait \`title\` (\`<= 100\` chars), 2–4 \`titleAlternates\`, ready-to-paste \`description\` with a 2-line above-the-fold hook and \`00:00\` chapters, plus 8–25 search \`tags\` formatted for comma-separated copy-and-paste.
- **Instagram Reels / Feed:** Punchy first-line \`hookLine\`, full story \`caption\` with save/share CTA, and 5–15 normalized \`hashtags\`.
- **TikTok:** Natural SEO \`caption\`, 3–8 search-bar \`seoKeywords\`, and 4–10 \`hashtags\`.
`,
};

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
