// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How each component's hosted file is made from its pinned source (build.mjs runs this; recipes.mjs has the
 * kinds). Every object lives at `<id>/<version>/<file>` under PUBLIC_BASE and never changes: a changed file gets a
 * new version. The ids and versions come from the manifests; this file adds what the manifests don't say.
 *
 * signature: 'taalcut' (every Mach-O Developer ID-signed by Taalcut's team, hardened runtime, secure timestamp),
 * 'none' (no Mach-O at all), or { team } (an upstream's own Developer ID, kept: Deno is signed and notarised by
 * Deno Land, and re-signing would drop that).
 */
import { ANUVANI } from './plan/anuvani.mjs';
import { AUDIO } from './plan/audio.mjs';
import { LINUX, LINUX_X64 } from './plan/linux.mjs';
import { LISTEN } from './plan/listen.mjs';
import { LOCAL_LLM } from './plan/local-llm.mjs';
import { LOCAL_LLM_MLX } from './plan/local-llm-mlx.mjs';
import { SFX_BANK } from './plan/sfx-bank.mjs';
import { TOOLS } from './plan/tools.mjs';
import { VISION, VISION_LINUX, VISION_PENDING } from './plan/vision.mjs';
import { WORKSPACE } from './plan/workspace.mjs';

export { PUBLIC_BASE } from './plan/common.mjs';
export { HOSTED_REPO_SOURCES } from './plan/hosted.mjs';

/** `plans` with each one's further platforms (`extra[id]` is its linux-x64 artifact's plan; artifacts.mjs). */
function withPlatform(plans, platform, extra) {
  return Object.fromEntries(
    Object.entries(plans).map(([id, plan]) => [
      id,
      extra[id] ? { ...plan, platforms: { ...plan.platforms, [platform]: extra[id] } } : plan,
    ]),
  );
}

/**
 * What the shipped manifest hosts: the Mac's builds, the linux-x64 ones since 2026-10-28 (LNX1-CMP), the
 * Indian-language identifier since 2026-10-29 (LIB1-LANG), and the listening models (EAR1-F3) and the SFX bank
 * (EAR1-D1) since 2026-11-07.
 */
export const PLAN = withPlatform(
  {
    ...LOCAL_LLM,
    ...VISION,
    ...AUDIO,
    ...TOOLS,
    ...LINUX,
    ...VISION_LINUX,
    ...ANUVANI,
    ...LISTEN,
    ...SFX_BANK,
    ...WORKSPACE,
    ...VISION_PENDING,
    ...LOCAL_LLM_MLX,
  },
  'linux-x64',
  LINUX_X64,
);

/**
 * With what the next release adds (compose-provisional.mjs's PENDING): what `build.mjs --pending` builds. A new
 * component's or platform's plans go here until they are hosted. The subject detector and MLX 9B runtime/model
 * graduated to PLAN on 2026-11-11 after public checksum verification.
 */
export const PENDING_PLAN = { ...PLAN };
