// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the last step, just describe it (UX4) · genre: atmospheric studio app · system: DESIGN.md v0.6
 * one field for the person's own words, its label above and an example under it; no button of its own: the step's
 *   primary, Make my first video, sends it (⌘Return in the field presses it too).
 * states: default · hover · focus (base ring) · disabled (a start in flight)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import { useEffect, useId, useRef } from 'react';

export function DescribePanel({
  words,
  onWords,
  disabled,
  onSubmit,
}: {
  words: string;
  onWords: (words: string) => void;
  disabled: boolean;
  onSubmit: () => void;
}) {
  const { t } = useLingui();
  const field = useId();
  const help = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);
  return (
    <div data-slot="describe-panel" className="flex flex-col gap-1.5">
      <label htmlFor={field} className="type-label text-ink">
        <Trans>The video you want</Trans>
      </label>
      <textarea
        ref={area}
        id={field}
        rows={3}
        value={words}
        disabled={disabled}
        aria-describedby={help}
        placeholder={t`A 30 second reel of my Goa trip, upbeat, the sunset last`}
        onChange={(event) => onWords(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
        className={cn(
          'w-full max-w-prose resize-y rounded-md border border-rule-strong bg-canvas px-3 py-2 type-body text-ink',
          'transition-colors duration-(--dur-micro) ease-(--ease-out) placeholder:text-ink-3 hover:border-ink-3',
          'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-disabled',
        )}
      />
      <p id={help} className="m-0 type-meta text-ink-2">
        {t`What it’s about, how long, and the feel.`}
      </p>
    </div>
  );
}
