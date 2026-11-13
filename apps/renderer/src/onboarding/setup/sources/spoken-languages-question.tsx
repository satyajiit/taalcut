// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, the languages in your videos (LIB1-LANG) · genre: atmospheric studio app ·
 *   system: DESIGN.md v0.7 + _orch/ux4/specs/design-onb.md
 * first run's one question about speech, on the step about your videos, under the ways in: a short heading, then
 *   what Taalcut will listen for first in one sentence ("English and Hindi"), and Change, which opens the same
 *   editor as Settings › General in place (a language added or removed saves at once; Done folds it again). Nothing
 *   to answer to go on: the app's language plus English stands until the person changes it
 * states: loading (the sentence waits) · default · open (the editor's own states) · folded again (focus stays on
 *   the toggle) */
import { useLingui } from '@lingui/react/macro';
import { Button, listOf } from '@taalcut/ui';
import { useId, useState } from 'react';
import { formatLanguage } from '../../../features/shared/format';
import { SpokenLanguagesEditor } from '../../../features/settings/speech/spoken-languages-editor';
import { useSpokenLanguages } from '../../../features/settings/speech/use-spoken-languages';

export function SpokenLanguagesQuestion() {
  const { t, i18n } = useLingui();
  const spoken = useSpokenLanguages();
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const panelId = useId();
  const names = listOf(
    i18n,
    spoken.languages.map((tag) => formatLanguage(i18n, tag)),
  );
  return (
    <section
      aria-labelledby={headingId}
      data-slot="spoken-languages-question"
      className="flex flex-col gap-2 border-t border-rule-subtle pt-4"
    >
      <h3 id={headingId} className="m-0 type-label text-ink">
        {t`Languages spoken in your videos`}
      </h3>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="m-0 type-prose text-pretty text-ink-2">
          {spoken.loading
            ? t`Taalcut listens for your languages first.`
            : t`Taalcut listens for ${names} first.`}
        </p>
        <Button
          size="sm"
          variant="ghost"
          data-action="spoken-languages"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? t`Done` : t`Change`}
        </Button>
      </div>
      <div id={panelId} hidden={!open}>
        {open ? <SpokenLanguagesEditor compact /> : null}
      </div>
    </section>
  );
}
