// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `workspace.lint`'s fix for the first error, as the exact line where one can be said (HFW1 dsn). eval:design's 9B
 * wrote scripts the lowering refuses and kept rewriting them the same way for 30 turns: positions worked out with
 * `if` and reassigned variables, words read from `window.__variables`, `CustomEase.create`, tweens built in a
 * `forEach`, tweens of a class the markup doesn't have, and selectors with pseudo-classes it can't follow. The fix points at the line (its number in the file and
 * its text), says what to write instead (null: delete it), and why, in the shape the gate takes. Otherwise it is
 * undefined and the finding's own hint stands. Nothing here designs: it only moves what the model wrote.
 */

/** The line to change: its number in the file, the line as written, what to write instead (null: delete it). */
export interface LintFix {
  readonly line: number;
  readonly now: string;
  /** Absent: the line stays, and `why` says what to change elsewhere. */
  readonly write?: string | null;
  /** A second line that follows from it: the declaration a rewritten tween no longer needs. */
  readonly then?: { readonly line: number; readonly now: string; readonly write: string | null };
  readonly why: string;
}

interface Line {
  readonly number: number;
  readonly text: string;
}

const QUERY =
  /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.(querySelector|querySelectorAll|getElementById|getElementsByClassName)\(\s*(['"`])([^'"`]+)\3\s*\)\s*;?\s*$/;
const TWEEN_OF_NAME = /\btl\.(to|from|fromTo|set)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/;
const STILL_ALLOWED = /^\s*(?:const\s+tl\s*=\s*gsap\.timeline|tl\.|window\.__timelines|\/\/|\/\*|\*|$|\}|\)|\{)/;

/** The script's lines, numbered as in the file. */
function scriptLines(text: string): Line[] {
  const open = /<script[^>]*>/.exec(text);
  if (!open) return [];
  const start = open.index + open[0].length;
  const end = text.indexOf('</script>', start);
  const before = text.slice(0, start).split('\n').length;
  return text
    .slice(start, end === -1 ? undefined : end)
    .split('\n')
    .map((line, index) => ({ number: before + index, text: line }));
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** The root element's inner markup: what the composition shows (the gate refuses an element outside it). */
function rootOf(text: string): { readonly inner: string; readonly start: number; readonly end: number } | null {
  const open = /<([a-z][a-z0-9-]*)\b[^>]*\sid="root"[^>]*>/i.exec(text);
  if (!open) return null;
  const start = open.index + open[0].length;
  const tag = /<(\/?)([a-z][a-z0-9-]*)\b[^>]*?(\/?)>/gi;
  tag.lastIndex = start;
  let depth = 1;
  for (let found = tag.exec(text); found; found = tag.exec(text)) {
    const [, closing, name = '', selfClosing] = found;
    if (VOID.has(name.toLowerCase()) || selfClosing) continue;
    depth += closing ? -1 : 1;
    if (depth === 0) return { inner: text.slice(start, found.index), start, end: found.index };
  }
  return null;
}

/** The ids and classes in some markup, as selectors. */
function selectorsIn(text: string): string[] {
  const markup = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => `#${match[1]}`).filter((id) => !id.endsWith('-template'));
  const classes = [...markup.matchAll(/\sclass="([^"]+)"/g)].flatMap((match) => (match[1] ?? '').split(/\s+/).filter(Boolean).map((name) => `.${name}`));
  return [...new Set([...ids, ...classes])].slice(0, 16);
}

const named = (name: string) => new RegExp(`(?<![\\w$.'"])${name.replace(/\$/g, '\\$')}(?![\\w$'"])`, 'g');

/** The line a "code outside the tween calls" excerpt starts at. */
function lineOf(lines: readonly Line[], message: string): Line | undefined {
  const quoted = /code outside the tween calls: (.+)$/.exec(message)?.[1]?.replace(/…$/, '').trim();
  if (!quoted) return lines.find((line) => line.text.trim() !== '' && !STILL_ALLOWED.test(line.text));
  const head = quoted.slice(0, 24);
  return lines.find((line) => line.text.replace(/\s+/g, ' ').trim().startsWith(head));
}

/** Why a line outside the tween calls goes, by what it does. */
function whyGone(line: string): string {
  if (/__variables/.test(line))
    return 'Words and values come from the composition’s variables in the markup, never from the script: delete this line and write the variable in the element.';
  if (/\.forEach\(|\bfor\s*\(|\.map\(|\bwhile\s*\(/.test(line))
    return 'Write each tween as its own call on tl; for a group, one call with stagger, e.g. tl.from(".item", { …, stagger: 0.08 }).';
  if (/\bCustomEase\b|\bregisterPlugin\b|\bgsap\.(?!timeline)/.test(line))
    return 'Taalcut loads GSAP and its plugins itself; an ease is a named string in the tween, e.g. ease: "power3.out" or "back.out(1.4)".';
  if (/^\s*if\b|^\s*[A-Za-z_$][\w$]*\s*[-+*/]?=[^=]|\b(?:const|let|var)\b/.test(line))
    return 'The script holds only tween calls: work any number out yourself and write it in the tween, or place the element with CSS.';
  return 'The script holds only tween calls on tl and its labels: delete this line.';
}

/** The fix for the first error, where its exact line can be said. */
export function lintFix(text: string, first: { readonly code: string; readonly message: string } | undefined): LintFix | undefined {
  if (!first) return undefined;
  const lines = scriptLines(text);
  if (lines.length === 0) return undefined;
  if (first.code === 'lower.scriptShape') {
    const line = lineOf(lines, first.message);
    return line ? { line: line.number, now: line.text.trim(), write: null, why: whyGone(line.text) } : undefined;
  }
  if (first.code !== 'lower.target') return undefined;
  const unsupported = /targets "([^"]+)", a selector form that is not supported/.exec(first.message)?.[1];
  if (unsupported) {
    const tween = lines.find((line) => line.text.includes(unsupported.replace(/…$/, '')));
    if (!tween) return undefined;
    return {
      line: tween.number,
      now: tween.text.trim(),
      why: `"${unsupported}" is a selector form the motion can't follow: use ids, classes, tags and attributes, alone or as descendants and children ("#box > span", ".card .word"), with no pseudo-classes but :first-child, :last-child, :nth-child(n, odd or even) and :not(…). Give the element a class of its own and target that.`,
    };
  }
  const missing = /targets "([^"]+)", which matches no element/.exec(first.message)?.[1];
  if (missing) {
    const root = rootOf(text);
    const inside = root ? selectorsIn(root.inner) : selectorsIn(text);
    const tween = lines.find((line) => line.text.includes(missing)) ?? lines.find((line) => /\btl\.(to|from|fromTo|set)\(/.test(line.text));
    if (!tween) return undefined;
    return {
      line: tween.number,
      now: tween.text.trim(),
      why: `No element inside the root matches "${missing}"${inside.length ? `; it has ${inside.join(', ')}` : ''}. Give the element that class or id in the markup, or target one it has.`,
    };
  }
  // A tween of a name the parser can't follow: write the selector the name was fetched with.
  const tween = lines.find((line) => TWEEN_OF_NAME.test(line.text));
  const name = tween ? (TWEEN_OF_NAME.exec(tween.text)?.[2] ?? '') : '';
  const declared = lines.find((line) => QUERY.exec(line.text)?.[1] === name);
  const query = declared ? QUERY.exec(declared.text) : null;
  if (!tween || !declared || !query) return undefined;
  const [, , method, , selector = ''] = query;
  const css = method === 'getElementById' ? `#${selector}` : method === 'getElementsByClassName' ? `.${selector}` : selector;
  return {
    line: tween.number,
    now: tween.text.trim(),
    write: tween.text.trim().replace(named(name), `'${css.replace(/'/g, '"')}'`),
    then: { line: declared.number, now: declared.text.trim(), write: null },
    why: 'A tween names its element by selector: write the selector in the tween and delete the line that fetched it.',
  };
}
