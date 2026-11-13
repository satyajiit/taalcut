// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: eval:make's words to the model besides the Maker's own instructions (run.ts gives it timeline.maker's
 * prompt and tool list): the task, which names the video and lists the reel's slots and graphics as the template has
 * them, and the loop's notes. Nothing here names a case's answer.
 */
import { RationalTime } from '@taalcut/core';
import type { MakeWorld } from './world';

export const WORDS_NOTE = `# Use your tools

Your last answer called no tool, and this work only moves through tools: draft, fix, draft again, then video.done. Call the one you need now.`;

export const LAST_NOTE = `# Last turn

This is your last turn: video.done is the only tool left. Call it, with a reason for each slot that still differs from the reel.`;

const seconds = (time: RationalTime) => Math.round(RationalTime.toSeconds(time) * 10) / 10;

/** The task: the video's ids and revision, and the reel's slots and graphics. */
export function makeTask(world: MakeWorld): string {
  const timeline = world.timeline();
  const slots = world.template.slots.map((slot, index) => {
    const intent = slot.intent;
    const parts = [
      `${index + 1}. ${seconds(slot.duration)} s: ${intent.text}`,
      ...(intent.needs?.length ? [`needs: ${intent.needs.join('; ')}`] : []),
      ...(intent.face ? [`face ${intent.face}`] : []),
      ...(intent.motion ? [`camera ${intent.motion}`] : []),
    ];
    return parts.join('. ');
  });
  const graphics = world.template.text
    .filter((overlay) => overlay.design)
    .map((overlay) => {
      const slot = world.template.slots.findIndex((entry) => entry.id === overlay.slotId) + 1;
      return `- a ${overlay.design!.kind} in slot ${slot} at ${seconds(overlay.start)} s: "${overlay.text}"`;
    });
  return [
    `Project ${world.projectId}, timeline ${world.timelineId}, at revision ${timeline.revision}: a first draft made like the reel. Make it match the reel, then finish with video.done.`,
    '',
    "The reel's slots:",
    ...slots,
    ...(graphics.length > 0 ? ['', "The reel's graphics:", ...graphics] : []),
  ].join('\n');
}
