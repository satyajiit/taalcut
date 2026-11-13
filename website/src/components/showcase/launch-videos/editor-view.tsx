// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the launch video, opened in the editor · mode: Operate · system: WEB2 Remix Vernacular
 * what Open editor opens: the video in the viewer at its first frame and on the timeline (apps/renderer/src/features/
 *   timeline, read, never imported), its scenes as the AI's graphics (violet, each with its words, still editable), the library's clips under the scene
 *   that uses them (the owner's footage), and the voiceover when there is one; the playhead at the start. Back to the
 *   video returns to the finished preview
 * states: with a voiceover · without one (no voice track) · Back to the video: the quiet button's states
 * motion: none of its own (the panel crossfades it in) */

import { ArrowLeft, AudioLines, Sticker } from 'lucide-react';
import type { ReactNode } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { buttonClasses } from '#components/ui/button-classes';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { Chip } from '../chip';
import { Filmstrip } from '../frame';
import { framesOf } from '../frames';
import { SceneFrame } from './scene-frame';
import { type Aspect, type Scene, type Voice } from './story';

const LANE = 'flex h-11 min-w-0 gap-0.5';

function Lane({ label, icon, children }: { readonly label: string; readonly icon: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2 @min-[40rem]:grid-cols-[6rem_minmax(0,1fr)]">
      <span className="flex items-center gap-1.5 type-meta text-ink-2">
        <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="sr-only @min-[40rem]:not-sr-only">{label}</span>
      </span>
      {children}
    </div>
  );
}

/** Width-led sizes that keep each format within the viewer's height. */
const VIEW: Readonly<Record<Aspect, string>> = {
  '16:9': 'w-full max-w-85',
  '9:16': 'w-full max-w-27',
  '1:1': 'w-full max-w-48',
  '4:5': 'w-full max-w-38.5',
};

export function EditorView({
  scenes,
  voice,
  aspect,
  onBack,
}: {
  readonly scenes: readonly Scene[];
  readonly voice: Voice;
  readonly aspect: Aspect;
  readonly onBack: () => void;
}) {
  const pick = scenes.findIndex((s) => s.look === 'pick');
  return (
    <section aria-label="The video in the editor" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="m-0 me-1 type-card-title text-ink">On the timeline</h4>
        <Chip tone="ai">
          <AiMark />
          {scenes.length} graphics, still editable
        </Chip>
        <button type="button" className={buttonClasses('quiet', 'md', 'ms-auto')} onClick={onBack}>
          <ArrowLeft aria-hidden className="size-4" />
          Back to the video
        </button>
      </div>
      <div className="flex h-56 items-center justify-center rounded-xl bg-viewer p-4">
        <SceneFrame scene={scenes[0]!} aspect={aspect} className={VIEW[aspect]} />
      </div>
      <div className="relative flex flex-col gap-2 rounded-xl border border-rule-subtle bg-sunken p-3">
        <Lane label="Graphics" icon={<Sticker strokeWidth={ICON_STROKE} className="size-4" />}>
          <ol aria-label="Graphics" className={cn(LANE, 'm-0 list-none p-0')}>
            {scenes.map((s, i) => (
              <li
                key={s.id}
                className="flex min-w-0 items-center gap-1 overflow-hidden rounded-md border-b-[3px] border-violet-strong bg-violet-soft px-1.5 text-violet-strong"
                style={{ flexGrow: s.seconds, flexBasis: 0 }}
              >
                <span className="sr-only">Scene {i + 1}: </span>
                <span className="truncate type-caption font-semibold">{s.words}</span>
              </li>
            ))}
          </ol>
        </Lane>
        <Lane label="Clips" icon={<ICONS.clip strokeWidth={ICON_STROKE} className="size-4" />}>
          <span aria-hidden className={LANE}>
            {scenes.map((s, i) => (
              <span key={s.id} className="flex min-w-0 gap-0.5" style={{ flexGrow: s.seconds, flexBasis: 0 }}>
                {i === pick
                  ? ['repeat-03', 'vietnam-12'].map((id) => (
                      <Filmstrip key={id} sprites={framesOf(id)} count={3} className="h-full min-w-0 flex-1 rounded-md" />
                    ))
                  : null}
              </span>
            ))}
          </span>
        </Lane>
        {voice === 'none' ? null : (
          <Lane label="Voiceover" icon={<AudioLines strokeWidth={ICON_STROKE} className="size-4" />}>
            <span aria-hidden className="flex h-8 items-center justify-between overflow-hidden rounded-md bg-teal-soft px-1.5">
              {Array.from({ length: 72 }, (_, i) => (
                <span
                  key={i}
                  className="w-[1.5px] shrink-0 rounded-pill bg-teal-strong"
                  style={{ height: `${18 + Math.round(64 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)))}%` }}
                />
              ))}
            </span>
          </Lane>
        )}
        <span aria-hidden className="absolute top-2 bottom-2 left-[calc(0.75rem+2rem)] w-0.5 rounded-pill bg-ink @min-[40rem]:left-[calc(0.75rem+6.5rem)]" />
      </div>
      <p className="m-0 max-w-prose type-body text-pretty text-ink-2">
        Each scene is a graphic the AI designed for this video. Change its values and its timing here, as with any
        video you make.
      </p>
    </section>
  );
}
