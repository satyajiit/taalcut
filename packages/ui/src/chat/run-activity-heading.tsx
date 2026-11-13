// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { ChevronDown } from 'lucide-react';
import { cn } from '#lib/cn';
import { ThoughtLine } from './thought-line';

/** One React Bits thinking cue; the disclosure owns interaction and typed steps stay in its body. */
export function RunActivityHeading({
  working,
  thinking,
  label,
  detail,
  open,
  regionId,
  onToggle,
}: {
  working: boolean;
  thinking: boolean;
  label: string;
  detail?: string | undefined;
  open: boolean;
  regionId: string;
  onToggle: () => void;
}) {
  const { t } = useLingui();
  const activeLabel = thinking ? t`Thinking…` : t`Working…`;
  return (
    <div className="group relative -ms-2 w-fit max-w-full rounded-md px-2 py-2 hover:bg-hover active:bg-pressed">
      <div aria-hidden className="pointer-events-none flex min-h-5 flex-wrap items-center gap-2 text-ink-2">
        <ThoughtLine
          working={working}
          label={activeLabel}
          doneLabel={label}
          showTimer={false}
          collapsible={false}
          glyph={working ? 'dot' : 'none'}
        />
        {detail ? <span className="type-meta">{detail}</span> : null}
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </div>
      <button
        type="button"
        data-slot="run-activity-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
        className="absolute inset-0 rounded-md"
      >
        <span className="sr-only">
          {working ? t`Activity · ${activeLabel}` : detail ? t`${label} · ${detail}` : label}
        </span>
      </button>
    </div>
  );
}
