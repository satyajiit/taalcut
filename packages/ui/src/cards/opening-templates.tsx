// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: opening choice, start from a template · genre: atmospheric studio app · system: DESIGN.md v0.3
 * saved templates as hairline rows (name as written, slots and length), then the bundled starters (P3-B3: name,
 *   length, what footage it needs, placeholder blocks), then the formats in words
 * states: loading (three still bones) · empty ("No templates yet": the reel way in) · default · hover (hover surface)
 *   · focus (base ring) · active (pressed) · disabled (a start in flight) · loading (the picked row spins)
 *   · error (the cause under the list) · success (the chat takes over) · UX1: starters that didn't load show the
 *   error line with Try again where they'd be (StartersFailed), never a silent gap · LRN1-TPL: the saved templates
 *   can be sorted by how well one source's clips fill them (fit/fit-order.tsx: SavedByFit), each row then saying so
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { useEffect, useState, type ReactNode } from 'react';
import { SavedByFit } from '../fit/fit-order';
import { SkeletonLines } from '../skeleton/skeleton';
import { useCardData, type TemplateChoice } from './card-data';
import { ErrorLine } from './error-line';
import { useStarterList } from './opening-starters';
import { StartersFailed } from './opening-starters-failed';
import { ChoiceGroup, keyOf, TemplateChoiceRow } from './template-choice-row';

export { OpeningStarters } from './opening-starters';

export interface OpeningTemplatesProps {
  disabled: boolean;
  onPick: (choice: TemplateChoice) => Promise<TaalcutError | null>;
  /** Nothing to pick: offers the reel way in instead. */
  onNone: () => void;
}

/** Saved templates first, then the bundled starters, then the built-in formats; one click starts the flow. */
export function OpeningTemplates({ disabled, onPick, onNone }: OpeningTemplatesProps) {
  const { t } = useLingui();
  const data = useCardData();
  const { starters: loaded, retry } = useStarterList();
  const [choices, setChoices] = useState<readonly TemplateChoice[] | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [failed, setFailed] = useState<TaalcutError | null>(null);

  useEffect(() => {
    let live = true;
    if (!data.templateChoices) {
      setChoices([]);
      return;
    }
    data.templateChoices().then(
      (found) => live && setChoices(found),
      () => live && setChoices([]),
    );
    return () => {
      live = false;
    };
  }, [data]);

  const pick = async (choice: TemplateChoice) => {
    setPicking(keyOf(choice));
    setFailed(null);
    const error = await onPick(choice);
    setPicking(null);
    if (error) setFailed(error);
  };

  if (choices === null || loaded === null) return <SkeletonLines lines={3} className="px-3 py-2" />;
  const saved = choices.filter((choice) => choice.kind === 'template');
  const formats = choices.filter((choice) => choice.kind === 'format');
  const starters = loaded === 'failed' ? [] : loaded;
  // "No templates yet" only when nothing is there: starters that failed to load say so where they'd be.
  if (choices.length === 0 && starters.length === 0 && loaded !== 'failed') {
    return (
      <p className="m-0 flex flex-wrap items-center gap-x-1 px-3 py-2 text-sm text-ink-2">
        <Trans>No templates yet.</Trans>
        <button
          type="button"
          onClick={onNone}
          className="cursor-pointer rounded-sm font-medium text-primary-strong underline underline-offset-2 hover:decoration-2"
        >
          <Trans>Paste a reel to make one</Trans>
        </button>
      </p>
    );
  }

  const row = (choice: TemplateChoice, extra: ReactNode = null) => (
    <TemplateChoiceRow
      key={`${choice.kind}:${keyOf(choice)}`}
      choice={choice}
      disabled={disabled || (picking !== null && picking !== keyOf(choice))}
      busy={picking === keyOf(choice)}
      onPick={() => void pick(choice)}
      extra={extra}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      {saved.length > 0 ? (
        <SavedByFit
          saved={saved}
          label={t`Your templates`}
          disabled={disabled || picking !== null}
          row={row}
        />
      ) : null}
      {starters.length > 0 ? (
        <ChoiceGroup heading={<Trans>Starters</Trans>}>{starters.map((choice) => row(choice))}</ChoiceGroup>
      ) : null}
      {loaded === 'failed' ? <StartersFailed onRetry={retry} disabled={disabled} /> : null}
      {formats.length > 0 ? (
        <ChoiceGroup heading={<Trans>Formats</Trans>}>{formats.map((choice) => row(choice))}</ChoiceGroup>
      ) : null}
      {failed ? <ErrorLine error={failed} className="px-3" /> : null}
    </div>
  );
}
