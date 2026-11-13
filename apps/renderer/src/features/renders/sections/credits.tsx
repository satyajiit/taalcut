// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: export section "Credits" · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the lines the stock's licences ask for in the post's description, then the courtesy
 *   ones (not required), each as its provider wrote it (translate="no"), in a sunken well you can select from;
 *   Copy puts them all on the clipboard. Shown when the video's stock or bundled sounds ask for credit, or when
 *   the credits couldn't be read.
 * states: default · hover/focus/active (Copy) · disabled (while the export starts) · loading (Copy while the
 *   clipboard answers) · error (Copy refused: one line to select and copy by hand; credits didn't load: the cause,
 *   Try again) · success ("Copied" with a check, announced, for a moment)
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 */
import { useLingui } from '@lingui/react/macro';
import { Button, ErrorLine } from '@taalcut/ui';
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SectionFrame, SectionNote } from './section-frame';
import type { ExportSection, SectionProps } from './types';

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

function Lines({ label, lines }: { label: string; lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 type-label-sm text-ink-2">{label}</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {lines.map((line) => (
          <li key={line} translate="no" className="type-body break-words text-ink select-text">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Credits({ context, reload, disabled }: SectionProps) {
  const { t } = useLingui();
  const [copy, setCopy] = useState<CopyState>('idle');
  useEffect(() => {
    if (copy !== 'copied') return;
    const timer = setTimeout(() => setCopy('idle'), 2400);
    return () => clearTimeout(timer);
  }, [copy]);
  const state = context.credits;
  if (state.status === 'error')
    return (
      <SectionFrame id="credits" title={t`Credits`}>
        <ErrorLine error={state.error} onRetry={reload} />
      </SectionFrame>
    );
  const { required, courtesy } = state.credits;
  const copyAll = async () => {
    setCopy('copying');
    try {
      await navigator.clipboard.writeText([...required, ...courtesy].join('\n'));
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };
  return (
    <SectionFrame
      id="credits"
      title={t`Credits`}
      aside={
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          loading={copy === 'copying'}
          onClick={() => void copyAll()}
        >
          {copy === 'copied' ? <Check aria-hidden className="text-success-strong" /> : <Copy aria-hidden />}
          {copy === 'copied' ? t`Copied` : t`Copy`}
        </Button>
      }
    >
      <SectionNote>{t`Put these in the post’s description.`}</SectionNote>
      <div className="flex flex-col gap-2.5 rounded-md border border-rule-subtle bg-well p-3">
        <Lines label={t`The licence asks for`} lines={required} />
        <Lines label={t`Courtesy, not required`} lines={courtesy} />
      </div>
      <p role="status" className="m-0 type-meta text-ink-2 empty:hidden">
        {copy === 'copied'
          ? t`Copied the credits.`
          : copy === 'failed'
            ? t`Couldn’t reach the clipboard. Select the lines and copy them yourself.`
            : ''}
      </p>
    </SectionFrame>
  );
}

export const creditsSection: ExportSection = {
  id: 'credits',
  available: ({ credits }) =>
    credits.status === 'error' || credits.credits.required.length + credits.credits.courtesy.length > 0,
  Component: Credits,
};
