// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The licence header rules check-spdx.mjs applies: which comment style each file type takes, whether a text
 * already has the header, and how --fix adds it. Pure, so each style has a test (headers.test.mjs).
 */
import { extname } from 'node:path';

export const SPDX = 'SPDX-License-Identifier: AGPL-3.0-or-later';
const COPYRIGHT = 'Copyright (C) 2026 Taalcut contributors';

const STYLES = {
  line: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.swift'],
  hash: ['.sh', '.py', '.yml', '.yaml', '.toml'],
  block: ['.css'],
  // Astro components: the header goes in the frontmatter as TypeScript line comments.
  astro: ['.astro'],
};

/** The comment style for a file, or null when the file type carries no header. */
export function styleFor(file) {
  const ext = extname(file);
  for (const [style, exts] of Object.entries(STYLES)) if (exts.includes(ext)) return style;
  return null;
}

function header(style) {
  if (style === 'line' || style === 'astro') return `// ${SPDX}\n// ${COPYRIGHT}\n`;
  if (style === 'hash') return `# ${SPDX}\n# ${COPYRIGHT}\n`;
  return `/* ${SPDX} */\n/* ${COPYRIGHT} */\n`;
}

export function hasHeader(text) {
  return text.split('\n', 6).some((line) => line.includes(SPDX));
}

export function addHeader(text, style) {
  const lines = text.split('\n');
  if (style === 'astro') {
    // Inside the frontmatter fence when there is one; otherwise a fence of its own.
    if (lines[0]?.trim() === '---') return `${lines[0]}\n${header(style)}${lines.slice(1).join('\n')}`;
    return `---\n${header(style)}---\n${text}`;
  }
  // Keep a shebang (or a YAML document marker) on the first line.
  if (lines[0]?.startsWith('#!')) return `${lines[0]}\n${header(style)}${lines.slice(1).join('\n')}`;
  return `${header(style)}${style === 'line' ? '\n' : ''}${text}`;
}
