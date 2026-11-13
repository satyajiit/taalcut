// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: one export step (UX4) · system: DESIGN.md v0.6 + UX4
 * the step's heading (h3, type-card-title), which takes focus when the step opens so a screen reader says where
 *   you are and the next Tab is the step's first control; one line on what it decides (type-meta, ink-2); then its
 *   sections, each without a heading of its own when it is the step's only one. The first step folds "For another
 *   editor" under its choice (another destination, not a step: Collapse moves what's under it). The summary step
 *   shows ExportSummary
 * states: the sections' own · the fold: closed (default) · open (aria-expanded; the chevron turns)
 */
import { useLingui } from '@lingui/react/macro';
import { Button, cn, Collapse } from '@taalcut/ui';
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ExportStep } from './export-steps';
import { EXPORT_SECTIONS, type ExportSectionId, type SectionProps } from './sections';
import { SectionHeadings } from './sections/section-frame';

export interface ExportStepBodyProps {
  step: ExportStep;
  /** The sections this export shows (decided when the dialog opened). */
  shown: readonly ExportSectionId[];
  props: SectionProps;
  /** The summary's content, for the summary step. */
  summary?: ReactNode;
}

function OtherEditors({ props }: { props: SectionProps }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const section = EXPORT_SECTIONS.find((candidate) => candidate.id === 'otherEditors');
  if (!section) return null;
  const { Component } = section;
  return (
    <div className="flex flex-col gap-2 border-t border-rule-subtle pt-3" data-slot="export-other-editors">
      <Button
        size="sm"
        variant="ghost"
        className="-ms-2 self-start"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((was) => !was)}
      >
        {t`Or take the cut to another editor`}
        <ChevronDown
          aria-hidden
          className={cn(
            'transition-transform duration-(--dur-micro) ease-(--ease-out)',
            open && 'rotate-180',
          )}
        />
      </Button>
      <Collapse open={open} id={regionId}>
        <div className="pt-1">
          <Component {...props} />
        </div>
      </Collapse>
    </div>
  );
}

export function ExportStepBody({ step, shown, props, summary }: ExportStepBodyProps) {
  const { i18n } = useLingui();
  const heading = useRef<HTMLHeadingElement>(null);
  // The step's heading takes focus when the step opens (the dialog's first step included). It keeps the base
  // :focus-visible ring, hugging its words: after a key it shows where focus went; after a click it doesn't show.
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const sections = EXPORT_SECTIONS.filter(
    (section) => step.sections.includes(section.id) && shown.includes(section.id),
  );
  return (
    <div data-slot="export-step" data-step={step.id} className="flex flex-col gap-5 pb-1">
      <div className="flex flex-col gap-1">
        <h3 ref={heading} tabIndex={-1} className="m-0 self-start rounded-sm type-card-title text-ink">
          {i18n._(step.heading ?? step.name)}
        </h3>
        <p className="m-0 max-w-prose type-meta text-ink-2">{i18n._(step.line)}</p>
      </div>
      {summary ?? (
        <SectionHeadings.Provider value={sections.length > 1}>
          <div className="flex flex-col gap-7">
            {sections.map(({ id, Component }) => (
              <Component key={id} {...props} />
            ))}
          </div>
          {step.id === 'destination' && shown.includes('otherEditors') ? (
            <OtherEditors props={props} />
          ) : null}
        </SectionHeadings.Provider>
      )}
    </div>
  );
}
