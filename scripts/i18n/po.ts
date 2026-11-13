// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export class PoSyntaxError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(message);
    this.name = 'PoSyntaxError';
    this.line = line;
  }
}

export interface PoComment {
  kind: 'translator' | 'reference' | 'flag' | 'previous' | 'obsolete' | 'other';
  raw: string;
}

export interface PoEntry {
  id: string;
  context?: string;
  msgstr: string;
  explicit: boolean;
  comments: PoComment[];
  line: number;
  msgstrLine: number;
  /** Offset of the entry's first line: its first comment, else msgctxt or msgid. */
  start: number;
  /** Offset of its msgctxt line, else its msgid line. */
  keywordStart: number;
  msgstrStart: number;
  msgstrEnd: number;
}

export interface PoFile {
  entries: PoEntry[];
}

interface Acc {
  comments: PoComment[];
  context: string;
  id: string;
  msgstr: string;
  sawMsgid: boolean;
  idLine: number;
  msgstrLine: number;
  start: number;
  keywordStart: number;
  msgstrStart: number;
  msgstrEnd: number;
  field: 'context' | 'id' | 'str' | null;
}

function emptyAcc(): Acc {
  return {
    comments: [],
    context: '',
    id: '',
    msgstr: '',
    sawMsgid: false,
    idLine: 0,
    msgstrLine: 0,
    start: -1,
    keywordStart: -1,
    msgstrStart: -1,
    msgstrEnd: -1,
    field: null,
  };
}

export function quotePo(value: string): string {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t')}"`;
}

export function unquotePo(token: string, line: number): string {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) {
    throw new PoSyntaxError(line, 'expected a quoted string');
  }
  const body = token.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) throw new PoSyntaxError(line, 'trailing backslash');
    i += 1;
    if (next === 'n') out += '\n';
    else if (next === 't') out += '\t';
    else if (next === 'r') out += '\r';
    else if (next === '\\') out += '\\';
    else if (next === '"') out += '"';
    else throw new PoSyntaxError(line, `unknown escape \\${next}`);
  }
  return out;
}

function commentKind(line: string): PoComment['kind'] {
  if (line.startsWith('#.')) return 'translator';
  if (line.startsWith('#:')) return 'reference';
  if (line.startsWith('#,')) return 'flag';
  if (line.startsWith('#|')) return 'previous';
  if (line.startsWith('#~')) return 'obsolete';
  return 'other';
}

/** Gettext key. Context uses the unit separator so the same sentence can be two messages. */
export function entryKey(entry: { id: string; context?: string }): string {
  return entry.context ? `${entry.context}\u0004${entry.id}` : entry.id;
}

/** English sentence. Explicit ids keep a stable msgid; the sentence is msgstr. */
export function englishSource(entry: PoEntry): string {
  if (entry.explicit) return entry.msgstr;
  return entry.msgstr || entry.id;
}

export function listCatalogueFiles(localesDir: string): Array<{ locale: string; file: string }> {
  if (!existsSync(localesDir)) return [];
  const found: Array<{ locale: string; file: string }> = [];
  for (const name of readdirSync(localesDir)) {
    const file = join(localesDir, name, 'messages.po');
    if (existsSync(file) && statSync(file).isFile()) found.push({ locale: name, file });
  }
  found.sort((a, b) => (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0));
  return found;
}

/** One line of a catalogue: its text, trimmed text, 1-based number and offset in the file. */
interface PoLine {
  text: string;
  trimmed: string;
  no: number;
  start: number;
}

function toEntry(acc: Acc): PoEntry {
  return {
    id: acc.id,
    context: acc.context === '' ? undefined : acc.context,
    msgstr: acc.msgstr,
    explicit: acc.comments.some((comment) => comment.raw.includes('js-lingui-explicit-id')),
    comments: acc.comments,
    line: acc.idLine,
    msgstrLine: acc.msgstrLine || acc.idLine,
    start: acc.start,
    keywordStart: acc.keywordStart,
    msgstrStart: acc.msgstrStart,
    msgstrEnd: acc.msgstrEnd,
  };
}

/** Reads a catalogue line by line, gathering one entry at a time; a comment or keyword after a msgid starts the next. */
class PoReader {
  readonly entries: PoEntry[] = [];
  private acc = emptyAcc();

  read(line: PoLine): void {
    if (line.trimmed === '') this.flush();
    else if (line.trimmed.startsWith('#')) this.comment(line);
    else if (line.trimmed.startsWith('"')) this.continuation(line);
    else this.keyword(line);
  }

  flush(): void {
    const acc = this.acc;
    this.acc = emptyAcc();
    if (!acc.sawMsgid || acc.id === '') return;
    if (acc.msgstrStart < 0) throw new PoSyntaxError(acc.idLine, 'missing msgstr');
    this.entries.push(toEntry(acc));
  }

  /** The line belongs to a new entry once the current one has its msgid; the entry starts at its first line. */
  private begin(line: PoLine): Acc {
    if (this.acc.sawMsgid) this.flush();
    if (this.acc.start < 0) this.acc.start = line.start;
    return this.acc;
  }

  private comment(line: PoLine): void {
    const acc = this.begin(line);
    acc.comments.push({ kind: commentKind(line.trimmed), raw: line.trimmed });
    acc.field = null;
  }

  private continuation(line: PoLine): void {
    const acc = this.acc;
    if (!acc.field) throw new PoSyntaxError(line.no, 'quoted string outside a message');
    const value = unquotePo(line.trimmed, line.no);
    if (acc.field === 'id') acc.id += value;
    else if (acc.field === 'context') acc.context += value;
    else {
      acc.msgstr += value;
      acc.msgstrEnd = line.start + line.text.trimEnd().length;
    }
  }

  private keyword(line: PoLine): void {
    const keyword = line.trimmed.split(' ')[0] ?? '';
    const token = line.trimmed.slice(keyword.length).trim();
    if (keyword === 'msgid_plural' || keyword.startsWith('msgstr[')) {
      throw new PoSyntaxError(line.no, 'gettext plurals are not used; write ICU in msgstr');
    }
    if (keyword === 'msgctxt') this.msgctxt(line, token);
    else if (keyword === 'msgid') this.msgid(line, token);
    else if (keyword === 'msgstr') this.msgstr(line, token);
    else throw new PoSyntaxError(line.no, `unexpected line: ${line.trimmed.slice(0, 40)}`);
  }

  private msgctxt(line: PoLine, token: string): void {
    const acc = this.begin(line);
    acc.keywordStart = line.start;
    acc.context = unquotePo(token, line.no);
    acc.field = 'context';
  }

  private msgid(line: PoLine, token: string): void {
    const acc = this.begin(line);
    if (acc.keywordStart < 0) acc.keywordStart = line.start;
    acc.id = unquotePo(token, line.no);
    acc.sawMsgid = true;
    acc.idLine = line.no;
    acc.field = 'id';
  }

  private msgstr(line: PoLine, token: string): void {
    const acc = this.acc;
    if (!acc.sawMsgid) throw new PoSyntaxError(line.no, 'msgstr before msgid');
    acc.msgstr = unquotePo(token, line.no);
    acc.msgstrLine = line.no;
    acc.msgstrStart = line.start + (line.text.length - line.text.trimStart().length);
    acc.msgstrEnd = line.start + line.text.trimEnd().length;
    acc.field = 'str';
  }
}

export function parsePo(text: string): PoFile {
  const reader = new PoReader();
  let start = 0;
  let no = 0;
  for (const raw of text.split('\n')) {
    no += 1;
    reader.read({ text: raw, trimmed: raw.trim(), no, start });
    start += raw.length + 1;
  }
  reader.flush();
  return { entries: reader.entries };
}
