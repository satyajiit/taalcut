// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/*
 * People's own words in every script the app has a face for: one English line with a phrase in another script,
 * at body and section sizes, so a jump in height or weight between the faces shows. The fallbacks are scaled to
 * Onest's x-height (src/fonts/fonts.css); CJK is drawn by the system's own fonts.
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { SCRIPT_LINE_LEAD, SCRIPT_LINE_TAIL, SCRIPT_LINES, type ScriptLine } from './samples';

function Line({ line, role }: { line: ScriptLine; role: 'type-body' | 'type-section' }) {
  return (
    <p lang="en" translate="no" className={`${role} m-0 text-ink`}>
      {SCRIPT_LINE_LEAD} · <bdi lang={line.lang}>{line.phrase}</bdi> · {SCRIPT_LINE_TAIL}
    </p>
  );
}

export function ScriptLines() {
  const { i18n } = useLingui();
  const languages = new Intl.DisplayNames([i18n.locale], { type: 'language' });
  const scripts = new Intl.DisplayNames([i18n.locale], { type: 'script' });
  return (
    <ul className="@container m-0 flex list-none flex-col divide-y divide-rule-subtle p-0">
      {SCRIPT_LINES.map((line) => {
        const language = languages.of(line.lang) ?? line.lang;
        const script = scripts.of(line.script) ?? line.script;
        const face = line.drawnBy;
        return (
          <li
            key={line.lang}
            className="grid grid-cols-1 items-baseline gap-x-6 gap-y-2 py-4 @3xl:grid-cols-[9rem_minmax(0,1fr)]"
          >
            <span className="type-meta flex flex-col text-ink-2">
              {/* Intl's own names, already in the reader's language (it has none for the pseudo-locale). */}
              <span translate="no" className="font-medium text-ink">
                {language}
              </span>
              <span translate="no">{script}</span>
              <span>
                {face === 'system' ? (
                  <Trans>the system’s own font</Trans>
                ) : (
                  <span translate="no">{face}</span>
                )}
              </span>
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <Line line={line} role="type-section" />
              <Line line={line} role="type-body" />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
