// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hub command names and payloads (P3-B12, P3-V8). Handlers: @taalcut/templates. Publishing, rating and
 * reporting talk to the Worker: external, person sources only (PERSON_SOURCES), never undone. A fork is a write
 * whose inverse is `template.discard`. `hub.openShare` is read: it emits ui.action so the window opens the Share
 * dialog (how the agent offers sharing; it can never share by itself).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { defineSetting } from '../ports/preferences';
import { languageTagSchema, sha256Schema } from '../templates/template-parts';
import { hubHandleSchema, hubTagSchema } from './hub-template';
import { HUB_REPORT_REASONS } from './worker-api';

export const HUB_COMMANDS = {
  publish: 'hub.publish',
  fork: 'hub.fork',
  /** null stars withdraws the rating. */
  rate: 'hub.rate',
  report: 'hub.report',
  openShare: 'hub.openShare',
} as const;

/** The CC0 dedication on the Share card: an acknowledgement, like a warning card's. */
export const HUB_LICENCE_TERMS = { featureId: 'hub.publish', termsVersion: '2026-10-14' } as const;

/** The handle this install shares under (remembered by the Share dialog). */
export const HUB_HANDLE_SETTING = defineSetting('hub.handle', hubHandleSchema.nullable(), null);

export const hubShareFormSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(280),
  handle: hubHandleSchema,
  tags: z.array(hubTagSchema).max(8),
  language: languageTagSchema.nullable(),
  includeStyle: z.boolean(),
});
export type HubShareForm = z.output<typeof hubShareFormSchema>;

const hubId = idSchema<'HubTemplate'>();
const templateId = idSchema<'Template'>();
const appWide = { projectId: z.null().default(null) };

export const hubCommandPayloads = {
  [HUB_COMMANDS.publish]: z.object({
    ...appWide,
    templateId,
    version: z.int().min(1),
    form: hubShareFormSchema,
    /** When the person ticked the CC0 line; records HUB_LICENCE_TERMS. */
    acknowledgedAt: z.int().nonnegative(),
  }),
  [HUB_COMMANDS.fork]: z.object({
    ...appWide,
    hubId,
    version: z.int().min(1),
    /** The index entry's hash: the file must match it (hub.integrity). */
    sha256: sha256Schema,
    /** The new template's id, made by the caller. */
    templateId,
  }),
  [HUB_COMMANDS.rate]: z.object({ ...appWide, hubId, stars: z.int().min(1).max(5).nullable() }),
  [HUB_COMMANDS.report]: z.object({
    ...appWide,
    hubId,
    reason: z.enum(HUB_REPORT_REASONS),
    note: z.string().trim().max(500).optional(),
  }),
  [HUB_COMMANDS.openShare]: z.object({ ...appWide, templateId, version: z.int().min(1).optional() }),
};
