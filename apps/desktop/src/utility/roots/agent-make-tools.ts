// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The make flow's tool modules in the agent process (P2-M13), in the order
 * the agent offers them after library, media and vision: templates and the
 * sandbox (the Analyst), render and captions (the Reviewer and the export),
 * and one `timeline` module with the timeline package's tools and render's
 * captureFrame (the Librarian and the Editor). AGT2's `video` module (video.done, then video.compare) stays after
 * render's, as one module: a registry takes one module per id. apps/gate-demo composes the
 * same modules in the same order, so a recorded session replays in both; a
 * change here means re-recording (TAALCUT_RECORD=1).
 */
import { TemplateStoreToken, TimelineStoreToken, type Container, type ToolModule } from '@taalcut/core';
import { eyesToolModules, withVideoEyes } from '@taalcut/render';
import { withAudioTools } from './agent-audio';
import { eyesDepsOf } from './agent-eyes';
import { renderAgentToolModules } from './agent-render';
import { templatesAgentToolModules } from './agent-templates';
import { timelineAgentToolModule } from './agent-timeline';

export function makeFlowToolModules(container: Container): ToolModule[] {
  const render = renderAgentToolModules(container);
  const stores = container.has(TemplateStoreToken) && container.has(TimelineStoreToken);
  if (!stores) return [...render.modules, render.timeline];
  // Phase 3 audio's modules come after these, and captions.translate joins render's `captions` (agent-audio.ts).
  // AGT2: video.compare (the draft next to the reel, render's eyes) joins match's `video` module.
  const eyes = eyesToolModules(eyesDepsOf(container));
  return withAudioTools(container, [
    ...templatesAgentToolModules(container),
    ...render.modules.map((module) => (module.id === 'video' ? withVideoEyes(module, eyes) : module)),
    timelineAgentToolModule(container, render.timeline),
  ]);
}
