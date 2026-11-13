// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/*
 * The specimen's samples of reading text: agent prose, numbers and timecodes, a button row, the brand moments'
 * display sizes, the body weight on this theme, and all of it again in Hindi. Words are data (samples.ts);
 * numbers are values, formatted by Intl in the sample's language.
 */
import { Button } from '@taalcut/ui';
import { Download, Repeat2, Undo2 } from 'lucide-react';
import { BarSample, SectionSample, SettingsSample, TemplateRowSample } from './sample-rows';
import type { Samples } from './samples';

/** Three paragraphs of the agent, at the prose measure. */
export function ProseSample({ s, paragraphs = s.prose.length }: { s: Samples; paragraphs?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {s.prose.slice(0, paragraphs).map((paragraph) => (
        <p key={paragraph} className="type-prose max-w-prose text-ink">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

function figure(lang: string, value: number, style: Samples['figures'][number]['style']): string {
  if (style === 'usd')
    return new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD' }).format(value);
  if (style === 'gb')
    return new Intl.NumberFormat(lang, { style: 'unit', unit: 'gigabyte', unitDisplay: 'short' }).format(
      value,
    );
  return new Intl.NumberFormat(lang).format(value);
}

/** Numbers that sit still (Onest's tabular figures) beside numbers that change in place (JetBrains Mono). */
export function NumbersSample({ s }: { s: Samples }) {
  return (
    <div className="flex flex-wrap gap-x-12 gap-y-6">
      <dl className="m-0 grid min-w-0 flex-[1_1_14rem] grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2">
        {s.figures.map((row) => (
          <div key={row.label} className="contents">
            <dt className="type-body text-ink-2">{row.label}</dt>
            <dd className="type-data m-0 text-end text-ink">{figure(s.lang, row.value, row.style)}</dd>
          </div>
        ))}
      </dl>
      <dl className="m-0 grid min-w-0 flex-[1_1_14rem] grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2">
        {s.timecodes.map((row) => (
          <div key={row.label} className="contents">
            <dt className="type-body text-ink-2">{row.label}</dt>
            <dd className="type-data tc-mono m-0 text-end text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The kit's buttons, which keep their own sizes: only the face changes. */
export function ButtonsSample({ s }: { s: Samples }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary">
        <Download aria-hidden />
        {s.buttons.primary}
      </Button>
      <Button>
        <Repeat2 aria-hidden />
        {s.buttons.secondary}
      </Button>
      <Button variant="ghost">{s.buttons.ghost}</Button>
      <Button variant="ghost" size="sm">
        <Undo2 aria-hidden />
        {s.buttons.undo}
      </Button>
    </div>
  );
}

/** Brand moments only: an export finished, and first run's step heading. */
export function BrandSample({ s }: { s: Samples }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="type-display text-ink">{s.display}</p>
      <p className="type-headline text-ink">{s.headline}</p>
    </div>
  );
}

const WEIGHTS = [360, 380, 400, 420, 450] as const;

/** Body and meta at five weights, on this theme's canvas: where the dark body weight was chosen (400). */
export function WeightSample({ s, weightLabel }: { s: Samples; weightLabel: (weight: number) => string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-3">
      {WEIGHTS.map((weight) => (
        <div key={weight} className="contents">
          <span className="type-meta text-ink-3">{weightLabel(weight)}</span>
          <p className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="type-body text-ink" style={{ fontWeight: weight }}>
              {s.weightLine}
            </span>
            <span className="type-meta text-ink-2" style={{ fontWeight: weight }}>
              {s.template.meta}
            </span>
          </p>
        </div>
      ))}
    </div>
  );
}

/** The same chrome and prose in Hindi: Devanagari beside Latin, at every role. */
export function HindiSample({ s }: { s: Samples }) {
  return (
    <div className="flex flex-col gap-5">
      <BarSample s={s} />
      <SectionSample s={s} />
      <SettingsSample s={s} rows={2} />
      <TemplateRowSample s={s} />
      <ProseSample s={s} paragraphs={2} />
      <NumbersSample s={s} />
      <ButtonsSample s={s} />
    </div>
  );
}
