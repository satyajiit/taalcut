// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · component: settings, language · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + UX4 (Settings › General; the kit's PageSection and Radio)
 * five choice rows in one raised list (Automatic with what it means here, then each language named in itself
 *   with `lang` set), a neutral "Draft translation" chip on the ones a native speaker hasn't signed off. The kit's
 *   Radio: arrow keys move and choose, the words are the hit area. The dot grows in; the words changing is the answer.
 * states: default · hover (hover surface) · focus (base ring on the row) · active (pressed surface) · checked
 *   (selected wash, ink 600) · disabled (while loading the state) · loading (the chosen row spins while the
 *   command runs; the list is aria-busy) · error (ErrorLine under the list) · success (polite announcement, in the
 *   new language)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { ErrorLine, PageSection, Skeleton } from '@taalcut/ui';
import { useEffect, useRef, type RefObject } from 'react';
import { useLocation } from '@tanstack/react-router';
import { LANGUAGE_NAMES } from '../../../i18n/use-locale';
import { BoneRows, type BoneRowShape } from '../bones';
import { LoadError } from '../fields';
import { ChoiceRows } from '../radio-row';
import { SETTINGS_ICONS } from '../settings-icons';
import { LanguageNotice } from './language-notice';
import { LanguageRow } from './language-row';
import { LANGUAGE_OPTIONS, useLanguageChoice } from './use-language-choice';

const LANGUAGE_BONES: readonly BoneRowShape[] = ['22%', '12%', '10%', '12%', '20%'].map((title) => ({
  title,
  icon: true,
}));

/** The anchor ⌘K's "Change language…" opens (go.language). */
export const LANGUAGE_ANCHOR = 'language';

/**
 * ⌘K "Change language…" lands here: the checked choice takes focus, so arrows pick at once (again whenever the
 * state changes while the anchor is in the address).
 */
function useFocusFromPalette(list: RefObject<HTMLDivElement | null>, data: object | undefined) {
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    if (hash !== LANGUAGE_ANCHOR || !data) return;
    const checked = list.current?.querySelector<HTMLElement>('[role=radio][data-state=checked]');
    checked?.focus();
    list.current?.scrollIntoView({ block: 'center' });
  }, [hash, data, list]);
}

/** Settings › General › Language (P3-L2): Automatic or one of the four, without a restart. */
export function LanguageSection() {
  const { t } = useLingui();
  const choice = useLanguageChoice();
  const list = useRef<HTMLDivElement>(null);
  const changedTo = choice.changedTo ? LANGUAGE_NAMES[choice.changedTo] : null;
  const { state } = choice;
  useFocusFromPalette(list, state.data);

  return (
    <PageSection
      title={<Trans>Language</Trans>}
      icon={SETTINGS_ICONS.language}
      description={
        <Trans>
          Taalcut’s words, dates and numbers. It switches at once, and the agent answers in it from your next
          message.
        </Trans>
      }
    >
      <div id={LANGUAGE_ANCHOR} className="flex flex-col gap-3 scroll-mt-24">
        <LanguageNotice />
        {state.status === 'error' && !state.data ? (
          <LoadError error={state.error} what={<Trans>The languages didn’t load.</Trans>} />
        ) : null}
        <Skeleton
          name="settings-language"
          loading={state.status !== 'error' && !state.data}
          fixture={<BoneRows rows={LANGUAGE_BONES} />}
        >
          {state.data ? (
            <div ref={list}>
              <ChoiceRows
                aria-label={t`Language`}
                loading={choice.pending !== null}
                value={choice.current ?? undefined}
                onValueChange={(next) => {
                  const preference = LANGUAGE_OPTIONS.find((option) => option === next);
                  if (preference) void choice.choose(preference);
                }}
              >
                {LANGUAGE_OPTIONS.map((preference) => (
                  <LanguageRow
                    key={preference}
                    preference={preference}
                    system={choice.system}
                    pending={choice.pending === preference}
                  />
                ))}
              </ChoiceRows>
            </div>
          ) : null}
        </Skeleton>
        {choice.error ? <ErrorLine error={choice.error} /> : null}
        <p aria-live="polite" className="sr-only">
          {changedTo ? t`Taalcut is now in ${changedTo}.` : ''}
        </p>
      </div>
    </PageSection>
  );
}
