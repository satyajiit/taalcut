// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: whether a post caption carries its platform's credit line (`POST_CAPTION_RULES[platform].credit`). On
 * until the person turns it off in the caption panel, and remembered app-wide. The caption tool reads it, so
 * the model never decides it: `settings.setPostCaptionCredit` takes a person's dispatch only.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ok } from '../basics/result';
import { defineCommand, PERSON_SOURCES } from '../commands/definition';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import { defineSetting, type SettingsStore } from '../ports/preferences';

export const POST_CAPTION_CREDIT_SETTING = defineSetting('postCaption.credit', z.boolean(), true);

export const postCaptionCreditStateSchema = z.object({ enabled: z.boolean() });
export type PostCaptionCreditState = z.output<typeof postCaptionCreditStateSchema>;

export const POST_CAPTION_SETTING_COMMANDS = { setCredit: 'settings.setPostCaptionCredit' } as const;

/** appContract.postCaption, owner agent. */
export const postCaptionContract = { credit: ipc.output(postCaptionCreditStateSchema) };

export function postCaptionRouter(settings: Pick<SettingsStore, 'get'>) {
  const os = implementContract(postCaptionContract);
  return os.router({
    credit: os.credit.handler(async () => ({
      enabled: unwrapRpc(await settings.get(POST_CAPTION_CREDIT_SETTING)),
    })),
  });
}

/** `settings.setPostCaptionCredit`, for the agent process's bus: app-wide, undoable, a person's only. */
export function createPostCaptionCreditCommands(settings: SettingsStore) {
  const setCredit = defineCommand({
    name: POST_CAPTION_SETTING_COMMANDS.setCredit,
    payload: postCaptionCreditStateSchema,
    sideEffect: 'write',
    project: () => null,
    sources: PERSON_SOURCES,
    async handle({ enabled }, context) {
      const before = await settings.get(POST_CAPTION_CREDIT_SETTING);
      if (!before.ok) return before;
      const saved = await settings.set(POST_CAPTION_CREDIT_SETTING, enabled, context);
      if (!saved.ok) return saved;
      return ok({
        result: { enabled: saved.value },
        inverse: { name: POST_CAPTION_SETTING_COMMANDS.setCredit, payload: { enabled: before.value } },
      });
    },
  });
  return { setCredit, all: [setCredit] };
}
