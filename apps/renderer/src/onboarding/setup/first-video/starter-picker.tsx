// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the last step, pick a starter (UX4) · genre: atmospheric studio app · system: DESIGN.md v0.6 +
 *   _orch/ux4/specs/design-onb.md
 * the bundled starters (P3-B3) as one choice: cards in a radio group, the best fit for the library first and chosen
 *   for you (it says so), each with its name, length and slots, the footage it needs in words, and a strip of
 *   placeholder blocks timed to its slots (D9: no frames). Choosing one doesn't start anything: the step's one
 *   primary, Make my first video, does.
 * states: loading (bones in the cards' shape) · default (hairline, raised) · hover (rule edge, eased) · focus (base
 *   ring on the card, instant) · active (pressed surface, gives 1 %) · chosen (marigold edge, the radio's dot) ·
 *   disabled (a start in flight) · didn't load (an alert where they'd be, with Try again) · none (an honest line)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  Chip,
  PRESS_ROW,
  SkeletonLines,
  StarterBlocks,
  VERB_ICONS,
  Button,
  CONCEPT_ICONS,
  Glyph,
  cn,
  useFormatters,
  type StarterChoice,
} from '@taalcut/ui';
import { useCallback, useEffect, useId, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { loadStarters } from '../../../chat/starter-actions';

/** The starters as they load: null while asking, `failed` when they couldn't be read. */
export type Starters = readonly StarterChoice[] | null | 'failed';

/** The starters for the app's language, best fit first, and Try again after a failure. */
export function useStarterChoices(): { starters: Starters; retry: () => void } {
  const backend = useBackend();
  const { i18n } = useLingui();
  const [starters, setStarters] = useState<Starters>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    loadStarters(backend, i18n).then(
      (found) => live && setStarters(found),
      () => live && setStarters('failed'),
    );
    return () => {
      live = false;
    };
  }, [backend, i18n, round]);
  const retry = useCallback(() => {
    setStarters(null);
    setRound((n) => n + 1);
  }, []);
  return { starters, retry };
}

/** The starters couldn't be read: said where they would be, with Try again. */
function StartersFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      data-slot="starters-failed"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-danger-strong/40 bg-danger-soft px-3 py-2"
    >
      <p className="m-0 flex min-w-0 flex-1 items-start gap-2 type-body text-danger-strong">
        <Glyph icon={CONCEPT_ICONS.error} className="mt-0.75" />
        <span className="min-w-0">
          <Trans>The starters didn’t load.</Trans>
        </span>
      </p>
      <Button size="sm" variant="secondary" icon={VERB_ICONS.retry} onClick={onRetry}>
        <Trans>Try again</Trans>
      </Button>
    </div>
  );
}

function StarterCard({
  choice,
  best,
  name,
  chosen,
  disabled,
  onChoose,
}: {
  choice: StarterChoice;
  best: boolean;
  /** The radio group's name. */
  name: string;
  chosen: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  const format = useFormatters();
  return (
    <div className="flex min-w-0">
      <label
        data-starter={choice.starterId}
        data-chosen={chosen || undefined}
        className={cn(
          'relative flex w-full cursor-pointer flex-col items-start gap-2 rounded-lg border bg-raised p-3',
          PRESS_ROW,
          'hover:border-rule active:bg-pressed',
          'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
          'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
          chosen
            ? 'border-primary-strong shadow-[inset_0_0_0_1px_var(--color-primary-strong)]'
            : 'border-rule-subtle',
        )}
      >
        <input
          type="radio"
          name={name}
          value={choice.starterId}
          checked={chosen}
          disabled={disabled}
          onChange={onChoose}
          className="sr-only"
        />
        <span className="flex w-full items-start justify-between gap-2">
          <span className="type-card-title text-ink">{choice.name}</span>
          <span
            aria-hidden
            className={cn(
              'mt-1 flex size-4 shrink-0 items-center justify-center rounded-pill border',
              chosen ? 'border-inverse bg-inverse' : 'border-rule-strong',
            )}
          >
            {chosen ? <span className="size-1.5 rounded-pill bg-on-inverse" /> : null}
          </span>
        </span>
        <span className="type-meta text-ink-2 tabular-nums">
          {/* Starters are whole-second shapes: "30s", never "25.6s". */}
          {format.duration(Math.round(choice.seconds) * 1000)}
          {' · '}
          <Plural value={choice.slotCount} one="# slot" other="# slots" />
        </span>
        <span className="type-body text-ink-2">{choice.needs}</span>
        {best ? (
          <Chip>
            <Trans>Fits your clips</Trans>
          </Chip>
        ) : null}
        <StarterBlocks blocks={choice.blocks} className="mt-auto pt-1" />
      </label>
    </div>
  );
}

export interface StarterPickerProps {
  readonly starters: Starters;
  readonly chosen: string | null;
  onChoose(choice: StarterChoice): void;
  onRetry(): void;
  readonly disabled: boolean;
}

/** The starters as one choice; the best fit is chosen when they arrive (the step does that). */
export function StarterPicker({ starters, chosen, onChoose, onRetry, disabled }: StarterPickerProps) {
  const { t } = useLingui();
  const name = useId();
  if (starters === 'failed') return <StartersFailed onRetry={onRetry} />;
  if (starters === null) return <SkeletonLines lines={4} className="py-2" />;
  if (starters.length === 0)
    return (
      <p role="status" className="m-0 type-body text-ink-2">
        <Trans>There are no starters yet. Paste a reel or describe your video instead.</Trans>
      </p>
    );
  return (
    <div className="@container">
      <div
        role="radiogroup"
        aria-label={t`Starters`}
        className="grid grid-cols-1 gap-3 @md:grid-cols-2 @[44rem]:grid-cols-4"
      >
        {starters.map((choice, i) => (
          <StarterCard
            key={choice.starterId}
            choice={choice}
            best={i === 0}
            name={name}
            chosen={chosen === choice.starterId}
            disabled={disabled}
            onChoose={() => onChoose(choice)}
          />
        ))}
      </div>
    </div>
  );
}
