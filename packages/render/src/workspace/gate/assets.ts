// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The files a prepared composition loads (HFW1): image sources in its markup and `url()`s in its style, never a
 * fragment (`#id`, its own paint or clip). The gate checks each is one of its files by sha256; the fold links them.
 */
import type { MarkupNode } from '../html/markup';
import type { PreparedComposition } from './prepare';

/** Every file path the composition loads: image sources in its markup, `url()`s in its style. */
export function assetReferences(prepared: PreparedComposition): string[] {
  const paths = new Set<string>();
  const walk = (node: MarkupNode) => {
    for (const name of ['src', 'href'])
      if (node.attributes[name] !== undefined && !node.attributes[name].startsWith('#'))
        paths.add(node.attributes[name]);
    for (const child of node.children) if (typeof child !== 'string') walk(child);
  };
  walk(prepared.doc.root);
  for (const match of prepared.doc.style.matchAll(/url\(\s*(['"]?)([^'"()\s]*)\1\s*\)/gi))
    if (match[2] && !match[2].startsWith('#')) paths.add(match[2]);
  return [...paths];
}
