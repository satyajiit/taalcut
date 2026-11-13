// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Release notes for the update dialog (docs/release.md checklist step 3): release-notes/<version>/<locale>.md for
 * en (required), hi, es and pt-BR, plain text with "- " bullets and **bold** only. They become the channel yml's
 * `releaseNotes`, one JSON string {"v":1,"notes":{...}} that the app parses (apps/desktop/src/main/update/
 * release-notes.ts). Refused here, before anything is published: HTML, images, and links to anywhere but the
 * project's own GitHub pages.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const NOTES_LOCALES = ['en', 'hi', 'es', 'pt-BR'] as const;
export type NotesLocale = (typeof NOTES_LOCALES)[number];
/** What UpdateState.ready.notes accepts per language. */
export const MAX_NOTES_CHARS = 8000;

/** Problems with one language's notes; empty when they are fine. */
export function notesProblems(text: string, repoUrl: string): string[] {
  const problems: string[] = [];
  if (!text.trim()) problems.push('is empty');
  if (text.length > MAX_NOTES_CHARS) problems.push(`is longer than ${MAX_NOTES_CHARS} characters`);
  if (/<\/?[A-Za-z][^>]*>/.test(text)) problems.push('has HTML (notes are plain text)');
  if (/!\[[^\]]*\]\(/.test(text)) problems.push('has an image');
  const allowed = `${repoUrl.replace(/\/+$/, '')}/`;
  for (const [url] of text.matchAll(/\bhttps?:\/\/[^\s)>\]]+/g)) {
    if (!url.startsWith(allowed)) problems.push(`links to ${url} (only ${allowed}… is allowed)`);
  }
  return problems;
}

/** The yml's releaseNotes from a version's notes folder; throws with every problem listed. */
export function releaseNotesJson(dir: string, repoUrl: string): string {
  if (!existsSync(join(dir, 'en.md'))) throw new Error(`${dir}/en.md is required`);
  const notes: Partial<Record<NotesLocale, string>> = {};
  const problems: string[] = [];
  for (const locale of NOTES_LOCALES) {
    const file = join(dir, `${locale}.md`);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').trim();
    for (const problem of notesProblems(text, repoUrl)) problems.push(`${locale}.md ${problem}`);
    notes[locale] = text;
  }
  if (problems.length > 0) throw new Error(`release notes in ${dir}:\n- ${problems.join('\n- ')}`);
  return JSON.stringify({ v: 1, notes });
}
