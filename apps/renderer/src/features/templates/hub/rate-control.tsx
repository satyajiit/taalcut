// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H5 E4 S5 R5 V4
 * Hallmark · component: rate control (/templates/hub/$hubId) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a small person-only action: five stars as a radio group (arrows move, Space picks), your
 *   stars filled in ink, Withdraw once you rated; the hub's mean beside it is the page's, not this control's
 * states: default · hover (the stars up to the pointer darken) · focus-visible (base ring on the star) · active ·
 *   disabled (while one is on its way) · loading (the line says "Sending") · error (the cause under it) · success
 *   ("Thanks for rating", or "Rating withdrawn")
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { callRpc, HUB_COMMANDS, type HubTemplateId, type TaalcutError } from '@taalcut/core';
import { Button, ErrorLine, cn } from '@taalcut/ui';
import { Star } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useBackend } from '../../../backend/backend';
import { noteHubRefusal } from './hub-limits';

const STARS = [1, 2, 3, 4, 5] as const;

export interface RateControlProps {
  readonly hubId: HubTemplateId;
  readonly mine: number | null;
  /** After the hub took it: the page reads the new mean. */
  onRated(): void;
}

export function RateControl({ hubId, mine, onRated }: RateControlProps) {
  const { t } = useLingui();
  const backend = useBackend();
  const labelId = useId();
  const [stars, setStars] = useState<number | null>(mine);
  const [hover, setHover] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const rate = async (next: number | null) => {
    setSending(true);
    setError(null);
    const done = await callRpc(
      backend.commands.dispatch({
        name: HUB_COMMANDS.rate,
        payload: { projectId: null, hubId, stars: next },
        source: 'ui',
      }),
    );
    setSending(false);
    if (!done.ok) {
      noteHubRefusal(done.error);
      return setError(done.error);
    }
    setStars(next);
    setSaid(next === null ? t`Rating withdrawn` : t`Thanks for rating`);
    onRated();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = stars ?? 0;
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = Math.min(5, Math.max(1, current + step));
    refs.current[next - 1]?.focus();
    void rate(next);
  };

  const shown = hover ?? stars ?? 0;
  return (
    <div data-slot="hub-rate" className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span id={labelId} className="text-sm font-medium text-ink">
          {stars ? t`Your rating` : t`Rate it`}
        </span>
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          aria-busy={sending || undefined}
          onKeyDown={onKeyDown}
          onPointerLeave={() => setHover(null)}
          className="flex items-center"
        >
          {STARS.map((value) => {
            return (
              <button
                key={value}
                ref={(element) => {
                  refs.current[value - 1] = element;
                }}
                type="button"
                role="radio"
                aria-checked={stars === value}
                aria-label={t`${plural(value, { one: '# star', other: '# stars' })}`}
                tabIndex={(stars ?? 1) === value ? 0 : -1}
                disabled={sending}
                onPointerEnter={() => setHover(value)}
                onClick={() => void rate(value)}
                className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-ink-3 transition-colors duration-(--dur-micro) hover:text-ink active:bg-pressed disabled:cursor-progress"
              >
                <Star aria-hidden className={cn('size-5', value <= shown && 'fill-current text-ink')} />
              </button>
            );
          })}
        </div>
        {stars ? (
          <Button size="sm" variant="ghost" disabled={sending} onClick={() => void rate(null)}>
            {t`Withdraw`}
          </Button>
        ) : null}
        {sending ? <span className="text-sm text-ink-2">{t`Sending`}</span> : null}
        {said && !sending && !error ? (
          <span role="status" className="text-sm text-success-strong">
            {said}
          </span>
        ) : null}
      </div>
      {error ? <ErrorLine error={error} /> : null}
    </div>
  );
}
