// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: settings-fields · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · structured settings sections, notices, and form fields; Select is re-exported
 * from @taalcut/ui so every settings dropdown shares the studio select control.
 * states: default · hover · focus · active · disabled · loading (aria-busy) · error (aria-invalid)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { Button, cn, Select, useHostPlatform, VERB_ICONS, type SelectProps } from '@taalcut/ui';
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { describeError } from './model-messages';

export { Select, type SelectProps };

/**
 * A settings section: a heading (h2 under the page's h1), a line on what it
 * does, optional right-hand action, then its controls. Separated by a hairline.
 */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      data-slot="settings-section"
      className={cn(
        'flex flex-col gap-4 border-t border-rule-subtle pt-7 first-of-type:border-t-0 first-of-type:pt-0',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
          <h2 id={id} className="m-0 text-lg font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {description ? <p className="m-0 max-w-prose type-body text-ink-2">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Label above a control, with an optional hint under it. */
export function Field({
  label,
  hint,
  children,
  htmlFor,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="type-label text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="m-0 type-meta text-ink-3">{hint}</p> : null}
    </div>
  );
}

const NOTICE_TONES = {
  warning: { icon: TriangleAlert, iconClassName: 'text-warning-strong' },
  danger: { icon: CircleAlert, iconClassName: 'text-danger-strong' },
  success: { icon: CircleCheck, iconClassName: 'text-success-strong' },
  info: { icon: Info, iconClassName: 'text-info-strong' },
} as const;

/**
 * A status line: the tone's icon, a plain sentence that says what to do, and
 * at most one fix (DESIGN.md "Errors", "Status"). No wash: `-soft` is for chips
 * and selected rows only (v0.2). A warning that stands on a page until it's
 * dealt with (a model retiring, Local only changing jobs) sits in a hairline
 * frame; errors, results and information are one line under what they're about.
 */
export function Notice({
  tone,
  children,
  action,
  role,
  className,
}: {
  tone: keyof typeof NOTICE_TONES;
  children: ReactNode;
  action?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}) {
  const { icon: Icon, iconClassName } = NOTICE_TONES[tone];
  return (
    <div
      role={role}
      data-slot="notice"
      data-tone={tone}
      className={cn(
        'flex flex-wrap items-start gap-x-2.5 gap-y-2 type-body text-ink',
        tone === 'warning' && 'rounded-lg border border-rule px-3.5 py-2.5',
        className,
      )}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', iconClassName)} />
      <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">{children}</div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * While a section's data arrives. Settings pages draw named skeletons instead (UX1); first run and the trace
 * viewer still use this. The e2e checks wait until nothing on the page is busy.
 */
export function Loading({ className }: { className?: string }) {
  return (
    <div
      data-slot="loading"
      aria-busy="true"
      className={cn('flex items-center gap-2 py-6 type-meta text-ink-3', className)}
    >
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      <Trans>Loading…</Trans>
    </div>
  );
}

/**
 * A request that failed: what didn't load (`what`, a short sentence), the cause in plain words and one way to
 * fix it (UX1, M24: never a cause alone, never "Something went wrong" when the error has words).
 */
export function LoadError({
  error,
  onRetry,
  what,
}: {
  error: TaalcutError;
  onRetry?: () => void;
  what?: ReactNode;
}) {
  const { i18n } = useLingui();
  const platform = useHostPlatform();
  return (
    <Notice
      tone="danger"
      role="alert"
      action={
        onRetry ? (
          <Button size="sm" icon={VERB_ICONS.retry} onClick={onRetry}>
            <Trans>Try again</Trans>
          </Button>
        ) : undefined
      }
    >
      {what ? <span className="font-medium text-ink">{what}</span> : null}
      <span className={what ? 'text-ink-2' : undefined}>{describeError(i18n, error, platform)}</span>
    </Notice>
  );
}
