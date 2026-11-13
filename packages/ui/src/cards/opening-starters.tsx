// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the starter templates · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the bundled starters (P3-B3) as the chat's "Starters" rows and first run's grid of eight: the name, the length,
 *   the footage it needs in words, and a strip of placeholder blocks timed to its slots (D9: no frames, the kit's
 *   neutral tones, widths from the slots). The first is the best fit for the library and says so.
 * states: loading (bones) · default (raised surface, hairline) · hover (ink-3 edge) · focus (base ring) · active
 *   (pressed surface) · disabled (another start in flight) · loading (the picked one spins, aria-busy) · error (the
 *   cause under the grid) · success (the chat takes over) · UX1: didn't load (StartersFailed, the error line with Try
 *   again) is not none (an honest line: there are no starters yet, paste a reel or describe instead)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError, TemplateId } from '@taalcut/core';
import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { Chip } from '../components/badge';
import { SkeletonLines } from '../skeleton/skeleton';
import { useCardActions } from './card-actions';
import { useCardData } from './card-data';
import type { StarterChoice } from './card-data-phase3';
import { ErrorLine } from './error-line';
import { StartersFailed } from './opening-starters-failed';

/** The starters as they load: null while asking, `failed` when they couldn't be read, else best fit first. */
export type StartersState = readonly StarterChoice[] | null | 'failed';

/** The starters for the app's language, and `retry` to ask again after a failure (UX1). */
export function useStarterList(): { starters: StartersState; retry: () => void } {
  const data = useCardData();
  const [starters, setStarters] = useState<StartersState>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let live = true;
    if (!data.starters) {
      setStarters([]);
      return;
    }
    data.starters().then(
      (found) => live && setStarters(found),
      () => live && setStarters('failed'),
    );
    return () => {
      live = false;
    };
  }, [data, asked]);
  const retry = useCallback(() => {
    setStarters(null);
    setAsked((count) => count + 1);
  }, []);
  return { starters, retry };
}

/** The starters for the app's language, best fit first; `failed` when they couldn't be read. */
export function useStarters(): StartersState {
  return useStarterList().starters;
}

/** Forks the starter, then starts the template flow at the fork; the error, if any, comes back. */
export function useStartStarter(
  begin?: (templateId: TemplateId, text: string) => Promise<TaalcutError | null>,
): (choice: StarterChoice) => Promise<TaalcutError | null> {
  const { t } = useLingui();
  const actions = useCardActions();
  return useCallback(
    async (choice) => {
      if (!actions.addStarter) return null;
      const added = await actions.addStarter(choice.starterId);
      if (!added.ok) return added.error;
      const name = choice.name;
      const text = t`Make a video with the “${name}” starter`;
      const { templateId } = added.value;
      if (begin) return begin(templateId, text);
      if (!actions.startFlow) return null;
      const started = await actions.startFlow({ path: 'template', templateId }, text);
      return started.ok ? null : started.error;
    },
    [actions, begin, t],
  );
}

/** The starter's slots as placeholder blocks, widths from their lengths (no frames). */
export function StarterBlocks({ blocks, className }: { blocks: readonly number[]; className?: string }) {
  return (
    <span aria-hidden data-slot="starter-blocks" className={cn('flex h-1.5 w-full gap-0.5', className)}>
      {blocks.map((seconds, i) => (
        <span
          // The blocks are a fixed sequence: their order is their identity.
          key={i}
          className={cn('min-w-0.5 rounded-xs', i % 2 === 0 ? 'bg-ink-3' : 'bg-rule-strong')}
          style={{ flexGrow: Math.max(seconds, 0.1), flexBasis: 0 }}
        />
      ))}
    </span>
  );
}

/** "30 sec · 12 slots": the line under a starter's name. */
export function StarterFacts({ choice }: { choice: StarterChoice }) {
  const format = useFormatters();
  return (
    <span className="text-sm text-ink-2 tabular-nums">
      {/* Starters are whole-second shapes: "30s", never "25.6s". */}
      {format.duration(Math.round(choice.seconds) * 1000)}
      {' · '}
      <Plural value={choice.slotCount} one="# slot" other="# slots" />
    </span>
  );
}

/** One starter in first run's grid: its name, length and slots, the footage it needs, and its blocks. */
function StarterCard({
  choice,
  best,
  disabled,
  busy,
  onPick,
}: {
  choice: StarterChoice;
  /** The best fit for the library: it says so. */
  best: boolean;
  disabled: boolean;
  busy: boolean;
  onPick: () => void;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        data-starter={choice.starterId}
        disabled={disabled}
        aria-busy={busy || undefined}
        onClick={onPick}
        className={cn(
          'flex h-full w-full cursor-pointer flex-col items-start gap-2 rounded-lg border border-rule-subtle bg-raised p-3 text-start',
          'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:border-ink-3 active:bg-pressed',
          'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-sunken',
        )}
      >
        <span className="flex w-full items-start justify-between gap-2">
          <span className="min-w-0 text-base font-medium text-ink">{choice.name}</span>
          {busy ? (
            <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin text-ink-2" />
          ) : null}
        </span>
        <StarterFacts choice={choice} />
        <span className="text-sm text-ink-2">{choice.needs}</span>
        {best ? (
          <Chip tone="neutral">
            <Trans>Fits your clips</Trans>
          </Chip>
        ) : null}
        <StarterBlocks blocks={choice.blocks} className="mt-auto" />
      </button>
    </li>
  );
}

export interface OpeningStartersProps {
  disabled?: boolean;
  /** The heading's id, for the grid's name. */
  labelledBy?: string;
  className?: string;
}

/**
 * First run's starter picker (docs/onboarding.md section 9): eight cards in a grid, best fit first; picking one
 * forks it and starts the chat at it.
 */
export function OpeningStarters({ disabled = false, labelledBy, className }: OpeningStartersProps) {
  const { t } = useLingui();
  const { starters, retry } = useStarterList();
  const start = useStartStarter();
  const [picking, setPicking] = useState<string | null>(null);
  const [failed, setFailed] = useState<TaalcutError | null>(null);

  // Bare lines take the cards' inset (p-3), so their text starts where the cards' text and the row's text do.
  if (starters === null) return <SkeletonLines lines={4} className={cn('px-3 py-2', className)} />;
  // Failed and empty are different things: a failure is an error with its fix; none is an honest line.
  if (starters === 'failed')
    return <StartersFailed onRetry={retry} disabled={disabled} className={className} />;
  if (starters.length === 0)
    return (
      <p role="status" className={cn('m-0 px-3 text-sm text-ink-2', className)}>
        <Trans>There are no starters yet. Paste a reel or describe your video instead.</Trans>
      </p>
    );

  const pick = async (choice: StarterChoice) => {
    setPicking(choice.starterId);
    setFailed(null);
    const error = await start(choice);
    setPicking(null);
    if (error) setFailed(error);
  };
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <ul
        {...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': t`Starters` })}
        className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4"
      >
        {starters.map((choice, i) => (
          <StarterCard
            key={choice.starterId}
            choice={choice}
            best={i === 0}
            disabled={disabled || (picking !== null && picking !== choice.starterId)}
            busy={picking === choice.starterId}
            onPick={() => void pick(choice)}
          />
        ))}
      </ul>
      {failed ? <ErrorLine error={failed} className="px-3" /> : null}
    </div>
  );
}
