// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { cataloguePath, isLocaleTag, SOURCE_LOCALE } from './paths.ts';
import { pluralNote } from './plurals.ts';
import { englishSource, entryKey, parsePo, quotePo, type PoComment, type PoEntry } from './po.ts';
import { needsReview, REVIEW_FLAG, REVIEW_NOTE_PREFIX } from './review.ts';

const NAMES: Record<string, string> = {
  en: 'English',
  'en-XA': 'the pseudo-locale',
  hi: 'Hindi',
  es: 'Spanish',
  'pt-BR': 'Brazilian Portuguese',
};

function languageName(locale: string): string {
  return NAMES[locale] ?? locale;
}

/** How far the catalogue is from sign-off, for the README. */
export interface ReviewCounts {
  /** Translations still flagged for native review. */
  drafts: number;
  /** Translated messages. */
  translated: number;
  /** Every message. */
  total: number;
}

function reviewSection(name: string, counts: ReviewCounts, glossary: boolean): string {
  const terms = glossary
    ? "\n`GLOSSARY.md` lists the words the drafts use for Taalcut's terms. If you change a term, change it in every string that uses it, and in the glossary.\n"
    : '';
  return `## Review

${counts.translated} of ${counts.total} messages are translated. ${counts.drafts} of them are drafts marked \`#, ${REVIEW_FLAG}\` ("Needs work" in Poedit): nobody who speaks ${name} natively has read them yet.

For each one, read it against the English, fix it, then remove \`${REVIEW_FLAG}\` (in Poedit, turn off "Needs work"). Leave the mark on anything you are not sure of. A \`# ${REVIEW_NOTE_PREFIX}\` line is the drafter's question for you: answer it by fixing the string, then delete the line. ${name} is signed off when no \`${REVIEW_FLAG}\` is left.
${terms}`;
}

export function translatorReadme(
  locale: string,
  counts: ReviewCounts = { drafts: 0, translated: 0, total: 0 },
  glossary = false,
): string {
  const name = languageName(locale);
  return `# Translating Taalcut into ${name}

Thank you. Write the way Taalcut talks: plain words, short sentences, warm and brief. Say "clip", not "asset".

## The file

\`${locale}.po\` holds every string of the window. \`${locale}.main.po\` holds the Mac's own: the app menu, notifications and the permission prompts macOS shows (use the words macOS itself uses in ${name} for its standard menu items). \`msgid\` is the English id. \`msgstr\` is your translation.

- Copy placeholders exactly. Do not translate the names inside \`{}\`. \`{name}\` stays \`{name}\`. \`{0}\` stays \`{0}\`.
- Keep numbered tags such as \`<0>\`, \`</0>\`, and \`<0/>\`. Move them with the words they wrap. They are links and emphasis in the app.
- In \`{entity, select, source {…} other {…}}\`, keep \`entity\`, \`select\`, and the case names (\`source\`, \`other\`). Translate only the text inside each case's braces.
- Do not change \`msgid\`, \`msgctxt\`, or the \`#.\` and \`#:\` lines.
- A line that starts with \`#. source:\` is the English sentence for a stable id. Translate that sentence, not the id.
- Plurals are ICU. Include every category below.

${reviewSection(name, counts, glossary)}
## Plurals

${pluralNote(locale)}

## Length

The pseudo-locale pads English by 30%, so we can see text that clips. Stay near the English length. About 30% longer at most, or the layout clips.

## Send it back

Send \`${locale}.po\` and \`${locale}.main.po\` back with the same names. Change only \`msgstr\`, the \`${REVIEW_FLAG}\` marks and your own \`#\` comments. Leave \`msgstr\` empty for a string you have not translated: the import keeps the translation that is already there. A developer imports it with:

\`node scripts/i18n.mjs import --locale ${locale} --from <the folder that holds ${locale}.po>\`

then \`pnpm --filter @taalcut/desktop i18n:extract\` to compile main's catalogue and its macOS prompts.
`;
}

const HANDOFF_COMMENTS: readonly PoComment['kind'][] = ['other', 'translator', 'reference', 'flag'];

function sourceComments(entry: PoEntry, english: string): string[] {
  if (!entry.explicit || english === '' || english === entry.id) return [];
  return english.split('\n').map((line) => `#. source: ${line}`);
}

export function serializeHandoff(
  locale: string,
  entries: PoEntry[],
  englishByKey: Map<string, string>,
): string {
  const header = [
    'msgid ""',
    'msgstr ""',
    '"MIME-Version: 1.0\\n"',
    '"Content-Type: text/plain; charset=utf-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"',
    `"Language: ${locale}\\n"`,
    '',
    '',
  ].join('\n');
  const body = entries
    .map((entry) => {
      const lines: string[] = [];
      const english = englishByKey.get(entryKey(entry)) ?? '';
      // The catalogue's order: translator notes, extracted notes (then the English for a stable id),
      // origins, flags. The review flag and the drafter's notes travel to the reviewer.
      for (const kind of HANDOFF_COMMENTS) {
        lines.push(
          ...entry.comments.filter((comment) => comment.kind === kind).map((comment) => comment.raw),
        );
        if (kind === 'translator') lines.push(...sourceComments(entry, english));
      }
      if (entry.context) lines.push(`msgctxt ${quotePo(entry.context)}`);
      lines.push(`msgid ${quotePo(entry.id)}`);
      lines.push(`msgstr ${quotePo(entry.msgstr)}`);
      return lines.join('\n');
    })
    .join('\n\n');
  return `${header}${body}${body === '' ? '' : '\n'}`;
}

/** One catalogue and its English, or why it can't be read. */
function readPair(
  file: string,
  englishFile: string,
): { entries: PoEntry[]; englishByKey: Map<string, string> } | { message: string } {
  try {
    const entries = parsePo(readFileSync(file, 'utf8')).entries;
    const englishByKey = new Map<string, string>();
    for (const entry of parsePo(readFileSync(englishFile, 'utf8')).entries)
      englishByKey.set(entryKey(entry), englishSource(entry));
    return { entries, englishByKey };
  } catch (error) {
    return { message: error instanceof Error ? error.message : 'could not read the catalogue' };
  }
}

export function writeHandoff(
  root: string,
  locale: string,
  outDir: string,
): { ok: true } | { ok: false; message: string } {
  if (!isLocaleTag(locale)) return { ok: false, message: `Unknown locale: ${locale}` };
  const file = cataloguePath(root, locale);
  if (!existsSync(file)) return { ok: false, message: `Unknown locale: ${locale}` };
  const window = readPair(file, cataloguePath(root, SOURCE_LOCALE));
  if ('message' in window) return { ok: false, message: window.message };
  // Main's catalogue (menu, notifications, macOS prompts) travels with it when it has this locale.
  const mainFile = cataloguePath(root, locale, 'main');
  const main = existsSync(mainFile)
    ? readPair(mainFile, cataloguePath(root, SOURCE_LOCALE, 'main'))
    : undefined;
  if (main && 'message' in main) return { ok: false, message: main.message };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${locale}.po`), serializeHandoff(locale, window.entries, window.englishByKey));
  if (main)
    writeFileSync(
      join(outDir, `${locale}.main.po`),
      serializeHandoff(locale, main.entries, main.englishByKey),
    );
  const all = [...window.entries, ...(main?.entries ?? [])];
  const translated = all.filter((entry) => entry.msgstr !== '');
  const counts: ReviewCounts = {
    drafts: translated.filter(needsReview).length,
    translated: translated.length,
    total: all.length,
  };
  // The terms the drafts use, kept beside the catalogue: `<locale>/glossary.md`.
  const glossary = join(dirname(file), 'glossary.md');
  const hasGlossary = existsSync(glossary);
  if (hasGlossary) copyFileSync(glossary, join(outDir, 'GLOSSARY.md'));
  writeFileSync(join(outDir, 'README.md'), translatorReadme(locale, counts, hasGlossary));
  return { ok: true };
}
