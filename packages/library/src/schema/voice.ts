// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drizzle table for voice consents (P3-B6, migration 22): core's VoiceConsent, a column per field. The
 * recording is a file in the consent store's folder, named by the consent id; it is never synced.
 */
import type { VoiceConsentId } from '@taalcut/core';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const voiceConsents = sqliteTable(
  'voice_consents',
  {
    id: text('id').$type<VoiceConsentId>().primaryKey(),
    /** Typed by the speaker; shown back to them; never sent to a model. */
    speakerName: text('speaker_name').notNull(),
    language: text('language').notNull(),
    termsVersion: text('terms_version').notNull(),
    recordingSha256: text('recording_sha256').notNull(),
    recordingDurationMs: integer('recording_duration_ms').notNull(),
    phraseMatch: real('phrase_match').notNull(),
    recordedAt: integer('recorded_at').notNull(),
    /** core voiceCloneSchema as JSON; null until a clone exists. */
    clone: text('clone', { mode: 'json' }).$type<unknown>(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('voice_consents_recorded_idx').on(t.recordedAt, t.id)],
);
