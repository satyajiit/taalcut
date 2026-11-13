// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Markup builders for compositions. Text from the template, the model or the
 * user is always escaped as text: it can never become markup, an attribute
 * or a script. JSON in <script type="application/json"> is escaped so it
 * can't close the tag.
 */

const TEXT_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => TEXT_ESCAPES[char] ?? char);
}

/** Characters JSON leaves raw that must not reach a script element: tag and entity openers, U+2028/9. */
const SCRIPT_UNSAFE = new Map<string, string>([
  ['<', '\\u003c'],
  ['>', '\\u003e'],
  ['&', '\\u0026'],
  [String.fromCharCode(0x2028), '\\u2028'],
  [String.fromCharCode(0x2029), '\\u2029'],
]);
const SCRIPT_UNSAFE_PATTERN = new RegExp(`[${[...SCRIPT_UNSAFE.keys()].join('')}]`, 'g');

/** JSON safe inside <script type="application/json">: no `</script`, no comment openers, no U+2028/9. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(SCRIPT_UNSAFE_PATTERN, (char) => SCRIPT_UNSAFE.get(char) ?? char);
}

const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]*$/;

/** An element with escaped attributes; `inner` must already be markup (built here or escaped). */
export function element(
  tag: string,
  attributes: Readonly<Record<string, string | true | undefined>>,
  inner = '',
  selfClosing = false,
): string {
  const parts = [tag];
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    if (!ATTRIBUTE_NAME.test(name)) throw new Error(`Bad attribute name '${name}'`);
    parts.push(value === true ? name : `${name}="${escapeHtml(value)}"`);
  }
  return selfClosing ? `<${parts.join(' ')}>` : `<${parts.join(' ')}>${inner}</${tag}>`;
}

/** A CSS string literal (font family names, url()s of bundle paths). */
export function cssString(value: string): string {
  return `'${value.replace(/[\\'\n\r]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)}'`;
}

/** Bundle-relative URL of a file name: each segment percent-encoded (font files have brackets and commas). */
export function bundleUrl(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
