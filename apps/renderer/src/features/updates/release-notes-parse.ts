// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Release notes are plain text with two marks only (apps/desktop SPEC, "Release notes in the update dialog"):
 * a line starting `- ` is a bullet, and `**words**` is bold. Nothing else is interpreted: no HTML, no links, no
 * images. The notes are data, never markup, so the dialog renders these parts as text nodes.
 */

/** A run of text, bold or not. */
export interface NoteRun {
  readonly text: string;
  readonly bold: boolean;
}

export type NoteBlock =
  | { readonly kind: 'paragraph'; readonly runs: readonly NoteRun[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly NoteRun[])[] };

/** `**bold**` pairs on one line; an unpaired `**` stays as written. */
export function parseRuns(line: string): NoteRun[] {
  const runs: NoteRun[] = [];
  let rest = line;
  while (rest.length > 0) {
    const open = rest.indexOf('**');
    const close = open < 0 ? -1 : rest.indexOf('**', open + 2);
    if (open < 0 || close < 0) {
      runs.push({ text: rest, bold: false });
      break;
    }
    if (open > 0) runs.push({ text: rest.slice(0, open), bold: false });
    const bold = rest.slice(open + 2, close);
    if (bold.length > 0) runs.push({ text: bold, bold: true });
    rest = rest.slice(close + 2);
  }
  return runs;
}

/** Blank lines end a paragraph or a list; consecutive `- ` lines make one list. */
export function parseReleaseNotes(notes: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  let items: NoteRun[][] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', runs: parseRuns(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (items.length > 0) blocks.push({ kind: 'list', items });
    items = [];
  };
  for (const raw of notes.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line.length === 0) {
      flushParagraph();
      flushList();
    } else if (line.startsWith('- ')) {
      flushParagraph();
      items.push(parseRuns(line.slice(2).trim()));
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
