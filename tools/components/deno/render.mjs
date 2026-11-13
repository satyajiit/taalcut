// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Deno's notice sections from what notice.mjs collected. Identical texts are quoted once and numbered; every crate
 * (or library, or file) lists the numbers of its texts, and every text lists what it is quoted for, so the notice
 * carries each licence text of each piece in full without repeating the same Apache-2.0 text two hundred times.
 * Pure: no files, no network.
 */
import { sha256Hex } from '../hosting/files.mjs';

/** Line endings and trailing space normalised, so the same text from two crates is one text. */
export const normalise = (text) => text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');

/** The numbered texts of a notice. `add` returns a text's number, the same for the same text. */
export class Texts {
  constructor() {
    this.byHash = new Map();
    this.list = [];
  }

  add(text, use) {
    const body = normalise(text);
    const hash = sha256Hex(body);
    let entry = this.byHash.get(hash);
    if (!entry) {
      entry = { number: this.list.length + 1, text: body, uses: [] };
      this.byHash.set(hash, entry);
      this.list.push(entry);
    }
    entry.uses.push(use);
    return entry.number;
  }
}

/** Words joined with `separator` into lines of at most `width` characters. */
export function wrap(words, separator = ', ', width = 110) {
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line}${separator}${word}` : word;
    if (line && next.length > width) {
      lines.push(`${line}${separator.trimEnd()}`);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/**
 * groups: [{ title, intro: [paragraph], items: [{ label, id?, note?, files: [{ name, text }] }] }], each item's
 * files numbered into `texts` in order (`id`, else `label`, names it where a text says what it is quoted for).
 * Returns the index sections, one per group.
 */
export function groupSections(groups, texts) {
  return groups.map((group) => {
    const lines = [...group.intro.flatMap((paragraph) => [paragraph, ''])];
    for (const item of group.items) {
      const numbers = item.files.map((file) =>
        texts.add(file.text, `${item.id ?? item.label} (${file.name})`),
      );
      lines.push(`${item.label}  texts ${[...new Set(numbers)].join(', ')}`);
      if (item.note) lines.push(`    ${item.note}`);
    }
    return { title: group.title, text: lines.join('\n') };
  });
}

/** The section quoting the notices in Deno's own files ([{ notice: { comment, files }, texts: [number] }]). */
export function embeddedSection(title, intro, quoted) {
  const parts = [intro];
  for (const { notice, numbers } of quoted)
    parts.push(
      [
        '----',
        notice.comment,
        '',
        `Heads ${notice.files.length} file${notice.files.length === 1 ? '' : 's'}:`,
        wrap(notice.files),
        `Texts: ${numbers.join(', ')}`,
      ].join('\n'),
    );
  return { title, text: parts.join('\n\n') };
}

/** One section per numbered text, saying what it is quoted for. */
export function textSections(texts) {
  return texts.list.map((entry) => ({
    title: `Text ${entry.number}: ${entry.uses[0]}${entry.uses.length > 1 ? ` and ${entry.uses.length - 1} more` : ''}`,
    text: `Quoted for:\n${wrap(entry.uses, '; ')}\n\n${entry.text}`,
  }));
}
