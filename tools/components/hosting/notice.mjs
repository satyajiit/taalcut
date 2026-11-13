// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The NOTICE.txt hosted beside every component (`<id>/<version>/NOTICE.txt`, the manifest's `licence.notice`,
 * which pins its size and sha256): what the component is, its licence and attribution as the manifest states
 * them, what Taalcut changed, where the corresponding source of its copyleft pieces is hosted, and the full text
 * of every licence that applies to the hosted bytes. Re-hosting is redistribution, so the notice travels with the
 * file. Pure: the caller reads the texts.
 */

const RULE = '='.repeat(78);

/**
 * component: the manifest entry ({ id, name, version, licence: { spdx, attribution } }).
 * url: the hosted file, or every one of them for a component with an artifact per platform.
 * changes: lines saying what Taalcut did to the upstream bytes (signed, repacked) or that it did nothing.
 * extra: further paragraphs (which pieces are copyleft, and why their sources are hosted).
 * sources: [{ url, size, sha256, what }], the corresponding sources hosted beside the component.
 * sections: [{ title, text }], the licence texts, in order.
 */
export function noticeText({ component, url, changes, extra = [], sources = [], sections }) {
  if (sections.length === 0) throw new Error(`${component.id}: a notice needs at least one licence text`);
  const urls = Array.isArray(url) ? url : [url];
  const lines = [
    `${component.name} ${component.version} (Taalcut component "${component.id}")`,
    ...(urls.length === 1 ? [`Hosted at ${urls[0]}`] : ['Hosted at:', ...urls.map((each) => `  ${each}`)]),
    '',
    `Licence: ${component.licence.spdx}`,
  ];
  if (component.licence.attribution) lines.push(component.licence.attribution);
  lines.push('', ...changes);
  for (const paragraph of extra) lines.push('', paragraph);
  if (sources.length > 0) {
    lines.push(
      '',
      'Corresponding source, hosted beside this file for as long as Taalcut hosts this component:',
    );
    for (const source of sources)
      lines.push(
        '',
        `  ${source.url}`,
        `  ${source.what}`,
        `  ${source.size} bytes, sha256 ${source.sha256}`,
      );
  }
  for (const section of sections) {
    const text = section.text.replace(/\r\n/g, '\n').replace(/\s+$/, '');
    lines.push('', RULE, section.title, RULE, '', text);
  }
  return `${lines.join('\n')}\n`;
}
