// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-DOCKCHAT: the project a reel run left behind, for the editor's chat: "Travel days in quick cuts", one video of
 * 32 clips cast from the reel of templates/reel-run-slots.ts, with the cast as that run held it (who picked, how
 * sure, how many other shots a slot). Its chat (chat/fake-seed-reel-run.ts) holds that run's cards. Seeded only
 * when asked for (options/reel-run.ts), so the specs that count the seeded projects keep their numbers.
 */
import type { CastId, ConversationId, ProjectId, TimelineId } from '@taalcut/core';
import { FIXTURE_NOW } from '../../../library/assets';
import { fakeUlid } from '../../../library/seed';
import { REEL_RUN_SLOTS } from '../../../templates/reel-run-slots';
import { reelRunTemplate } from '../../../templates/template-reel-run';
import { MAKE_KIND } from '../../ids';
import type { Seeder } from './seeder';

export const REEL_RUN_PROJECT = fakeUlid<'Project'>(MAKE_KIND.project, 70) as ProjectId;
export const REEL_RUN_TIMELINE = fakeUlid<'Timeline'>(MAKE_KIND.timeline, 70) as TimelineId;
export const REEL_RUN_CAST = fakeUlid<'Cast'>(MAKE_KIND.cast, 70) as CastId;
/** The project's chat: the conversation the run was in. */
export const REEL_RUN_CONVERSATION = fakeUlid<'Conversation'>(MAKE_KIND.conversation, 70) as ConversationId;
/** The chat with every card in it (chat/fake-seed-every-card.ts), the project's chat when asked for. */
export const EVERY_CARD_CONVERSATION = fakeUlid<'Conversation'>(MAKE_KIND.conversation, 71) as ConversationId;

const HOUR = 3_600_000;

/** Which chat the project has: the run's own, or the one with every card. */
export type ReelRunChat = 'run' | 'everyCard';

/** `areas.reelRun` as the seed reads it: `true` seeds the project with the run's chat, 'everyCard' with that one. */
export const reelRunSeeded = (areas: Readonly<Record<string, unknown>> | undefined): ReelRunChat | null =>
  areas?.reelRun === true ? 'run' : areas?.reelRun === 'everyCard' ? 'everyCard' : null;

export const seedReelRun: Seeder = (tools) => {
  const chat = reelRunSeeded(tools.areas);
  if (!chat) return [];
  const template = reelRunTemplate();
  const createdAt = FIXTURE_NOW - 3 * HOUR;
  const built = tools.build({
    id: REEL_RUN_TIMELINE,
    n: 70,
    projectId: REEL_RUN_PROJECT,
    name: 'Travel Days in Quick Cuts',
    template: { id: template.id, version: template.version },
    beatMap: template.beatMap,
    slots: template.slots.map((slot) => ({ slotId: slot.id, frames: slot.duration.value, beatIndex: null })),
    pool: tools.pool(140, 70),
    variantIndex: 0,
    variantCount: 1,
    castId: REEL_RUN_CAST,
    mode: 'template',
    text: [],
    captions: [],
    language: 'en',
    unsure: [],
    createdAt,
  });
  if (!built.cast) return [];
  const timeline = {
    ...built,
    cast: {
      ...built.cast,
      sequenceConfidence: 0.06,
      slots: built.cast.slots.map((slot, index) => {
        const held = REEL_RUN_SLOTS[index];
        return held
          ? {
              ...slot,
              confidence: held.confidence,
              note: held.note,
              needsRerank: held.note === null && held.confidence !== null && held.confidence < 0.5,
              alternates: slot.alternates.slice(0, held.alternates),
            }
          : slot;
      }),
    },
  };
  return [
    {
      id: REEL_RUN_PROJECT,
      name: 'Travel days in quick cuts',
      createdAt,
      archivedAt: null,
      timelines: [timeline],
      conversationId: chat === 'everyCard' ? EVERY_CARD_CONVERSATION : REEL_RUN_CONVERSATION,
    },
  ];
};
