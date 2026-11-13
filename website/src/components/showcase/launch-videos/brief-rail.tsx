// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the brief and its sources, as a rail · mode: Operate · system: WEB2 Remix Vernacular
 * Create › Product launch's brief, compact, under the video it made (create-start.tsx, create-fields.tsx,
 *   create-sources.tsx): the category and the idea; the output formats as four shape toggles (turn one off and its
 *   frame leaves the video above); the voiceover; and the sources research read: taalcut.app with its screenshots,
 *   the site's project folder with its app captured in an isolated copy, two clips from the library at their own
 *   9:16, and the voice recording when the voiceover is yours
 * states: a format toggle: on (the strong edge, the raised face, the shape filled) · off · hover · focus (the ring on
 *   the pill) · the last one on can't be turned off (every video needs a format) · the voiceover: the select's own
 *   states · a source: read (the AI's tick)
 * motion: none of its own */

import { Check, Folder, Globe, Mic } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { Chip } from '../chip';
import { ClipFrame } from '../frame';
import { frameOf } from '../frames';
import { BRIEF, FORMATS, type Aspect, type Source, sourcesFor, type Voice, VOICES } from './story';

const SHAPES: Readonly<Record<Aspect, string>> = {
  '16:9': 'aspect-video w-5',
  '9:16': 'aspect-[9/16] h-5',
  '1:1': 'aspect-square h-4',
  '4:5': 'aspect-[4/5] h-4.5',
};

export function RailHeading({ children, aside }: { readonly children: ReactNode; readonly aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="m-0 me-1 type-card-title text-ink">{children}</h4>
      {aside}
    </div>
  );
}

function SourceIcon({ source }: { readonly source: Source }) {
  if (source.kind === 'media') return <ClipFrame sprite={frameOf(source.clipId)} className="w-5 rounded-sm" />;
  const Icon = source.kind === 'website' ? Globe : source.kind === 'folder' ? Folder : Mic;
  return (
    <span aria-hidden className="inline-grid size-8 place-items-center rounded-lg bg-raised text-ink-2">
      <Icon strokeWidth={ICON_STROKE} className="size-4" />
    </span>
  );
}

export function BriefRail({
  formats,
  onFormat,
  voice,
  onVoice,
}: {
  readonly formats: readonly Aspect[];
  readonly onFormat: (format: Aspect) => void;
  readonly voice: Voice;
  readonly onVoice: (voice: Voice) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-labelledby={`${id}-brief`} className="flex flex-col gap-3">
        <RailHeading aside={<Chip tone="ai">{BRIEF.category}</Chip>}>
          <span id={`${id}-brief`}>Brief</span>
        </RailHeading>
        <p className="m-0 type-body text-pretty text-ink-2">{BRIEF.idea}</p>
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 type-label-sm text-ink">Output formats</legend>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map((f) => {
              const on = formats.includes(f.id);
              return (
                <label
                  key={f.id}
                  className={cn(
                    'inline-flex h-9 cursor-pointer items-center gap-2 rounded-pill border px-3 type-label-sm whitespace-nowrap transition-colors duration-(--dur-micro)',
                    'has-[:focus-visible]:outline has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                    on ? 'border-rule-strong bg-raised text-ink' : 'border-rule bg-transparent text-ink-2 hover:border-rule-strong hover:text-ink',
                  )}
                >
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => onFormat(f.id)} aria-label={f.label} />
                  <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center">
                    <span className={cn('block rounded-[3px] border-[1.5px]', on ? 'border-ink bg-ink/15' : 'border-rule-strong', SHAPES[f.id])} />
                  </span>
                  <span aria-hidden className="tabular-nums">
                    {f.id}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor={`${id}-voice`} className="type-label-sm text-ink">
            Voiceover
          </label>
          <select
            id={`${id}-voice`}
            value={voice}
            onChange={(e) => onVoice(e.target.value as Voice)}
            className="h-9 min-w-0 rounded-lg border border-rule-strong bg-raised px-2.5 type-body text-ink hover:bg-hover"
          >
            {VOICES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section aria-labelledby={`${id}-sources`} className="flex flex-col gap-2">
        <RailHeading>
          <span id={`${id}-sources`}>Sources</span>
        </RailHeading>
        <p className="m-0 type-meta text-ink-2">Taalcut reads only the sources you choose.</p>
        <ul aria-label="Sources" className="m-0 flex list-none flex-col p-0">
          {sourcesFor(voice).map((source) => (
            <li key={source.id} data-source={source.kind} className="flex min-h-11 items-center gap-3 border-b border-rule-subtle py-1.5 last:border-b-0">
              <span className="inline-flex w-8 shrink-0 justify-center">
                <SourceIcon source={source} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate type-label-sm text-ink">{source.name}</span>
                <span className="type-meta text-pretty text-ink-2">{source.read}</span>
              </span>
              <Check aria-hidden strokeWidth={2.5} className="size-4 shrink-0 text-violet-strong" />
              <span className="sr-only">, read</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
