// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Release notes for the update dialog (P3-B9). The release workflow writes the channel yml's `releaseNotes` as a
 * JSON string, {"v":1,"notes":{"en":"…","hi":"…","es":"…","pt-BR":"…"}} (scripts/rollout/release-notes.ts).
 * The person's language wins, else English; anything that isn't that JSON is shown as one plain English text.
 * Notes are data, never markup: the renderer shows them as text ("- " bullets and **bold** are the only marks it
 * styles), so HTML in them is shown as the characters it is. Control characters go, and the length is capped
 * at what UpdateState accepts.
 */
import { APP_LOCALES, type AppLocale } from '@taalcut/core';
import { z } from 'zod';

export const MAX_NOTES_LENGTH = 8000;

const localeNotes = z.string().min(1).max(64_000);
const notesDocumentSchema = z.object({
  v: z.literal(1),
  notes: z
    .object(Object.fromEntries(APP_LOCALES.map((locale) => [locale, localeNotes.optional()])))
    .refine((notes) => typeof notes.en === 'string', { message: 'English notes are required' }),
});

/** What the update library hands over: a string, or one note per version when fullChangelog is on. */
export type RawReleaseNotes =
  string | readonly { readonly version: string; readonly note: string | null }[] | null | undefined;

/** Notes in `locale` (else English), cleaned; undefined when the release has none. */
export function releaseNotesFor(raw: RawReleaseNotes, locale: AppLocale): string | undefined {
  const text = typeof raw === 'string' ? raw : (raw ?? []).map((entry) => entry.note ?? '').join('\n\n');
  if (!text.trim()) return undefined;
  const chosen = pick(text, locale) ?? text;
  const cleaned = clean(chosen);
  return cleaned ? cleaned : undefined;
}

function pick(text: string, locale: AppLocale): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = notesDocumentSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const notes = parsed.data.notes;
  return notes[locale] ?? notes.en;
}

/** Plain text: no control characters but newlines and tabs, Windows newlines folded, capped. */
function clean(text: string): string {
  const normalised = text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- control characters are exactly what this removes
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim();
  return normalised.length > MAX_NOTES_LENGTH ? `${normalised.slice(0, MAX_NOTES_LENGTH - 1)}…` : normalised;
}

/** The update library's releaseDate (ISO text) as epoch ms; undefined when absent or unreadable. */
export function releaseDateOf(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at >= 0 ? at : undefined;
}
