// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: what Taalcut isn't sure of about the whole reel (BRK1-REV) · system: DESIGN.md
 *   v0.7 (warning yellow's dashed circle for something to check, always with its words)
 * the reel's own doubts (BRK1 §1): its beat may be twice or half as fast, its speech may be misheard over the music,
 *   it doesn't say whose sound it is. Each with its fix: Half as many beats or Twice as many beats for the tempo
 *   (template.setTempo), Add the credit for the sound (template.setSoundCredit, a form in place), and Leave it as
 *   it is (template.doubt.dismiss). They stay in view until answered, whatever the review is on: the current one
 *   with its answers, the others a line each that takes you to it
 * states: default · current (the item the review is on: the hover surface and its answers) · other (one line, a
 *   button to it) · crediting (the credit's form) · working (the pressed button spins) · read-only (the words alone)
 */
import { useLingui } from '@lingui/react/macro';
import type { Template } from '@taalcut/core';
import { useState } from 'react';
import { Button } from '#components/button';
import { DOUBT_WORDS, type CheckItem } from './review-checks';
import { REVIEW_ICONS } from './review-icons';
import { SoundCreditForm } from './sound-credit-form';
import type { ReviewEdit, ReviewEdits } from './use-review-edits';

export interface ReelDoubtsProps {
  template: Template;
  items: readonly CheckItem[];
  current: CheckItem | null;
  edits: ReviewEdits;
  editable: boolean;
  /** An answer took this doubt: the review goes on to the next thing to check. */
  onAnswered?: ((keys: readonly string[]) => void) | undefined;
  /** A line that isn't current was picked: the review goes to it. */
  onPick?: ((item: CheckItem) => void) | undefined;
}

export function ReelDoubts({
  template,
  items,
  current,
  edits,
  editable,
  onAnswered,
  onPick,
}: ReelDoubtsProps) {
  const { t, i18n } = useLingui();
  const [crediting, setCrediting] = useState(false);
  const reel = items.filter((item) => item.target.kind === 'reel');
  const ToCheck = REVIEW_ICONS.toCheck;
  if (reel.length === 0) return null;
  const answer = async (edit: ReviewEdit, key: string) => {
    if (await edits.run(edit)) onAnswered?.([key]);
  };
  const bpm = template.beatMap?.bpm ? i18n.number(Math.round(template.beatMap.bpm)) : null;
  // On a slot, the panel's header: a line each, above the slot's own scroll.
  const header = Boolean(onPick) && !reel.some((item) => item.key === current?.key);
  return (
    <section
      data-slot="reel-doubts"
      data-header={header || undefined}
      aria-label={t`The whole reel`}
      className="flex flex-col gap-2 data-header:gap-0.5 data-header:border-b data-header:border-rule-subtle data-header:pb-2"
    >
      <h3
        tabIndex={-1}
        data-landing="reel"
        className={
          header
            ? 'm-0 type-label-sm text-ink-2'
            : 'm-0 rounded-sm type-card-title text-ink focus-visible:-outline-offset-2'
        }
      >
        {t`The whole reel`}
      </h3>
      <ul className={header ? 'm-0 flex list-none flex-col p-0' : 'm-0 flex list-none flex-col gap-2 p-0'}>
        {reel.map((item) => {
          const isCurrent = item.key === current?.key;
          const words = (
            <>
              <ToCheck aria-hidden className="mt-1 size-3.5 shrink-0 text-warning-strong" />
              {/* In the header a line each, cut short: picking it shows it whole. */}
              <span className={header ? 'min-w-0 truncate' : undefined}>
                {i18n._(DOUBT_WORDS[item.reason])}
                {item.reason === 'tempoMaybeHalfOrDouble' && bpm ? (
                  <span className="text-ink-2"> · {t`now ${bpm} beats a minute`}</span>
                ) : null}
              </span>
            </>
          );
          // Not the one the review is on: a line that takes you to it, so what's open about the reel stays in view.
          if (!isCurrent && onPick)
            return (
              <li key={item.key} data-slot="reel-doubt">
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  className="flex w-full items-start gap-1.5 rounded-md px-2 py-0.5 text-start type-body text-ink-2 hover:bg-hover hover:text-ink"
                >
                  {words}
                </button>
              </li>
            );
          const credit = item.reason === 'soundCreditMissing';
          return (
            <li
              key={item.key}
              data-slot="reel-doubt"
              data-current={isCurrent || undefined}
              className="flex flex-col gap-2 rounded-md px-2 py-1.5 data-current:bg-hover"
            >
              <p className="m-0 flex items-start gap-1.5 type-body text-ink">{words}</p>
              {editable && credit && crediting ? (
                <div className="ps-5">
                  <SoundCreditForm
                    initial={template.audio.sound}
                    saving={edits.pending === 'soundCredit'}
                    onSave={async (given) => {
                      const done = await edits.run({ kind: 'soundCredit', credit: given });
                      if (done) {
                        setCrediting(false);
                        onAnswered?.([item.key]);
                      }
                      return done;
                    }}
                    onCancel={() => {
                      setCrediting(false);
                      requestAnimationFrame(() =>
                        document
                          .querySelector<HTMLElement>('[data-slot=add-credit]')
                          ?.focus({ preventScroll: true }),
                      );
                    }}
                  />
                </div>
              ) : editable ? (
                <div className="flex flex-wrap gap-2 ps-5">
                  {item.reason === 'tempoMaybeHalfOrDouble' && template.beatMap ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={REVIEW_ICONS.tempo}
                        loading={edits.pending === 'tempo'}
                        onClick={() => void answer({ kind: 'tempo', factor: 0.5 }, item.key)}
                      >
                        {t`Half as many beats`}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={REVIEW_ICONS.tempo}
                        disabled={edits.pending === 'tempo'}
                        onClick={() => void answer({ kind: 'tempo', factor: 2 }, item.key)}
                      >
                        {t`Twice as many beats`}
                      </Button>
                    </>
                  ) : null}
                  {credit ? (
                    <Button
                      data-slot="add-credit"
                      size="sm"
                      variant="secondary"
                      icon={REVIEW_ICONS.credit}
                      onClick={() => setCrediting(true)}
                    >
                      {t`Add the credit`}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={REVIEW_ICONS.looksRight}
                    loading={edits.pending === 'dismiss'}
                    onClick={() =>
                      void answer(
                        { kind: 'dismiss', target: { kind: 'template' }, reason: item.reason },
                        item.key,
                      )
                    }
                  >
                    {t`Leave it as it is`}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
