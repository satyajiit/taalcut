// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · pre-emit critique: P5 H4 E5 S5 R5 V4
 * Hallmark · component: warning card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 "Decision cards" + v0.4 (UX1) · it asks you to decide, so it is a decision card:
 * `raised`, a `rule` hairline all round, `xl` radius, no shadow, no wash, the title at 700; the warning lives in
 * the yellow shield and the words, not in a tinted slab. The safer path is the screen's one marigold fill.
 * states: checking (nothing yet: the guarded thing or the card follows) · needed (the card) · saving ("I
 *   understand" loading) · acknowledged (the guarded thing in its place, silently) · its buttons carry the eight
 *   states */

import { Trans, useLingui } from '@lingui/react/macro';
import { ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import type { Acknowledgement, AcknowledgementStore } from './acknowledgements';

export type AcknowledgementStatus = 'checking' | 'needed' | 'acknowledged';

/** Whether this warning still needs an "I understand", and the function that records one. */
export function useAcknowledgement(
  store: AcknowledgementStore,
  topic: string,
  termsVersion: string,
): { status: AcknowledgementStatus; acknowledge: (context?: unknown) => Promise<Acknowledgement> } {
  const [status, setStatus] = useState<AcknowledgementStatus>('checking');
  useEffect(() => {
    let live = true;
    setStatus('checking');
    store.has(topic, termsVersion).then(
      (known) => live && setStatus(known ? 'acknowledged' : 'needed'),
      () => live && setStatus('needed'),
    );
    return () => {
      live = false;
    };
  }, [store, topic, termsVersion]);
  const acknowledge = useCallback(
    async (context?: unknown) => {
      const record = await store.record({ topic, termsVersion, context });
      setStatus('acknowledged');
      return record;
    },
    [store, topic, termsVersion],
  );
  return { status, acknowledge };
}

export interface WarningCardProps {
  /** Which warning; with `termsVersion`, the key the acknowledgement is stored under. */
  topic: string;
  /** Bump it when the terms change: the card shows again. */
  termsVersion: string;
  store: AcknowledgementStore;
  title: ReactNode;
  /** What could happen, in plain words. */
  risk: ReactNode;
  /** Who bears the risk: usually "you", sometimes the account owner. */
  bearer: ReactNode;
  /** The safer path, one tap away. */
  saferAlternative: { label: string; onSelect: () => void };
  /** Called after "I understand" is recorded. */
  onAcknowledged?: (acknowledgement: Acknowledgement) => void;
  /** Stored with the acknowledgement, e.g. which account or link. */
  context?: unknown;
  /**
   * What the warning guards. Rendered instead of the card once this terms
   * version is acknowledged, now or earlier. Without children the card simply
   * disappears.
   */
  children?: ReactNode;
  /**
   * Focus moves to the card when it shows: for a warning that comes up in answer to what you just did (a reel's
   * link sent), so the keyboard and VoiceOver are on the question rather than where the card pushed them from.
   * `'acknowledge'`: to its "I understand" instead, for a card you asked for to say it (an error's fix, "Read the
   * warning"), where that is the one press left.
   */
  autoFocus?: boolean | 'acknowledge';
  className?: string;
}

/**
 * The warning-card pattern (PRD 10.1), one component for every user-risk
 * feature: what could happen, who bears the risk, the safer alternative as
 * one tap, and an "I understand" stored with a timestamp. It comes back only
 * when the terms version changes.
 */
export function WarningCard(props: WarningCardProps) {
  const { topic, termsVersion, store, title, risk, bearer, saferAlternative, children, className } = props;
  const { t } = useLingui();
  const headingId = useId();
  const { status, acknowledge } = useAcknowledgement(store, topic, termsVersion);
  const [saving, setSaving] = useState(false);
  const focusOnShow = useCallback((node: HTMLElement | null) => node?.focus(), []);

  if (status === 'acknowledged') return <>{children}</>;
  if (status === 'checking') return null;

  const confirm = async () => {
    setSaving(true);
    try {
      const record = await acknowledge(props.context);
      props.onAcknowledged?.(record);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      ref={props.autoFocus === true ? focusOnShow : undefined}
      tabIndex={props.autoFocus === true ? -1 : undefined}
      aria-labelledby={headingId}
      data-slot="warning-card"
      data-topic={topic}
      className={cn('flex flex-col gap-4 rounded-xl border border-rule bg-raised p-5 text-ink', className)}
    >
      <header className="flex items-start gap-3">
        <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning-strong" />
        <h3 id={headingId} className="m-0 type-section font-bold">
          {title}
        </h3>
      </header>
      <dl className="m-0 grid gap-3 ps-8 type-body">
        <div className="flex flex-col gap-0.5">
          <dt className="type-meta font-semibold text-ink-2">
            <Trans>What could happen</Trans>
          </dt>
          <dd className="m-0">{risk}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="type-meta font-semibold text-ink-2">
            <Trans>Who bears the risk</Trans>
          </dt>
          <dd className="m-0">{bearer}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2 ps-8">
        <Button variant="primary" data-action="safer" onClick={saferAlternative.onSelect}>
          {saferAlternative.label}
        </Button>
        <Button
          ref={props.autoFocus === 'acknowledge' ? focusOnShow : undefined}
          loading={saving}
          data-action="acknowledge"
          onClick={() => void confirm()}
          aria-describedby={headingId}
        >
          {t`I understand`}
        </Button>
      </div>
    </section>
  );
}
