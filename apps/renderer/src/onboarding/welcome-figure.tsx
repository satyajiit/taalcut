// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the welcome's figure · genre: atmospheric studio app (brand moment) · system: DESIGN.md v0.4
 * one still picture of what Taalcut does, drawn in the timeline's own language (DESIGN.md, Timeline): a reel's
 *   sound as rose bars with its beats standing out, four cuts as neutral blocks on the sunken bed whose edges fall
 *   exactly on those beats (a hairline guide drops from each beat), rose ticks below, the marigold playhead, the
 *   agent's pick with its violet bottom edge and your swap with its teal wash and edge. Under it, three plain
 *   sentences, each led by the mark it explains. A brand moment, so all four accents appear, each doing its job.
 * motion: none (it is there when the page opens; the count-in is the welcome's one moment)
 * states: n/a (a figure, not a control)
 */
import { Trans } from '@lingui/react/macro';
import { cn } from '@taalcut/ui';
import type { ReactNode } from 'react';

/** Where the cuts fall, as fractions of the reel: each one on a beat. */
const CUTS = [0, 0.22, 0.5, 0.74, 1] as const;
/** Who chose each clip: the agent (violet edge), you (teal wash and edge), or neither yet. */
const CHOSEN: readonly ('ai' | 'you' | null)[] = [null, 'ai', 'you', null];
/** The clips' file names, as a camera writes them (not words: never translated). */
const CLIP_NAMES = ['IMG_0418', 'DJI_0092', 'IMG_0503', 'IMG_0511'] as const;
/** The playhead's place, in the third clip. */
const PLAYHEAD = 0.69;
/** The reel's sound between the beats: 48 steady bars (fixed heights, so the picture never changes). */
const BARS = Array.from({ length: 48 }, (_, i) => ({
  at: (i + 0.5) / 48,
  height: 0.3 + 0.24 * Math.abs(Math.sin(i * 1.7)),
})).filter(({ at }) => CUTS.every((cut) => Math.abs(cut - at) > 0.015));
/** Half-beats between the cuts: shorter ticks. */
const OFFBEATS = CUTS.slice(0, -1).map((at, i) => (at + (CUTS[i + 1] ?? 1)) / 2);

const pct = (fraction: number) => `${fraction * 100}%`;

/** The reel's sound in rose: quieter bars, and a full-height bar on every beat. */
function Waveform() {
  return (
    <div className="relative h-16">
      {BARS.map(({ at, height }) => (
        <span
          key={at}
          className="absolute bottom-0 w-0.5 -translate-x-1/2 rounded-pill bg-beat-strong/35"
          style={{ left: pct(at), height: pct(height) }}
        />
      ))}
      {CUTS.map((at) => (
        <span
          key={at}
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-pill bg-beat-strong"
          style={{ left: pct(at) }}
        />
      ))}
    </div>
  );
}

function Cuts() {
  return (
    <div className="relative h-24">
      {CUTS.slice(0, -1).map((start, i) => {
        const end = CUTS[i + 1] ?? 1;
        const by = CHOSEN[i];
        return (
          <span
            key={start}
            className="absolute inset-y-0 px-0.5"
            style={{ left: pct(start), width: pct(end - start) }}
          >
            {/* A clip as an editor shows it: a strip of its frames on the viewer's grey, then its name. */}
            <span className="relative flex size-full flex-col gap-1.5 overflow-hidden rounded-clip border border-rule-subtle bg-raised p-1">
              {by === 'you' ? <span className="absolute inset-0 bg-you-soft/45" /> : null}
              {/* 9:16 frames at this height (31.5 px), a hairline between them, cut off where the clip ends. */}
              <span className="relative block h-14 shrink-0 rounded-[2px] bg-[repeating-linear-gradient(to_right,var(--color-viewer)_0_31px,var(--color-viewer-rule)_31px_32px)]" />
              <span
                translate="no"
                className="relative truncate px-0.5 text-2xs leading-3 font-medium text-ink-2"
              >
                {CLIP_NAMES[i]}
              </span>
              {by ? (
                <span
                  className={cn(
                    'absolute inset-x-0 bottom-0 h-[3px]',
                    by === 'you' ? 'bg-you-strong' : 'bg-ai-strong',
                  )}
                />
              ) : null}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function Ticks() {
  return (
    <div className="relative h-3">
      {[...CUTS.map((at) => ({ at, down: true })), ...OFFBEATS.map((at) => ({ at, down: false }))].map(
        ({ at, down }) => (
          <span
            key={at}
            className={cn(
              'absolute top-0 w-px -translate-x-1/2 rounded-pill bg-beat-strong',
              down ? 'h-3' : 'h-1.5',
            )}
            style={{ left: pct(at) }}
          />
        ),
      )}
    </div>
  );
}

/** The mark a sentence explains, drawn as it is in the figure. */
function Mark({ kind }: { kind: 'beat' | 'ai' | 'you' }) {
  if (kind === 'beat')
    return (
      <span className="flex h-6 w-4 shrink-0 items-center justify-center">
        <span className="h-4 w-0.5 rounded-pill bg-beat-strong" />
      </span>
    );
  return (
    <span className="relative mt-1 h-3.5 w-4 shrink-0 overflow-hidden rounded-clip border border-rule-subtle bg-raised">
      {kind === 'you' ? <span className="absolute inset-0 bg-you-soft/45" /> : null}
      <span
        className={cn(
          'absolute inset-x-0 bottom-0 h-[3px]',
          kind === 'you' ? 'bg-you-strong' : 'bg-ai-strong',
        )}
      />
    </span>
  );
}

function Meaning({ kind, children }: { kind: 'beat' | 'ai' | 'you'; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-base text-ink">
      <Mark kind={kind} />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** The welcome's picture: a reel's beats, four cuts on them, and what the colours mean. */
export function WelcomeFigure({ className }: { className?: string }) {
  return (
    <figure data-slot="welcome-figure" className={cn('m-0 flex min-w-0 flex-col gap-6', className)}>
      <div aria-hidden className="relative flex flex-col gap-2 rounded-xl bg-panel p-3">
        <Waveform />
        <Cuts />
        <Ticks />
        {/* The guides: from each beat down through the cut it starts. */}
        {CUTS.map((at) => (
          <span
            key={at}
            className="pointer-events-none absolute top-3 bottom-3 w-px -translate-x-1/2 bg-beat-strong/25"
            style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${at})` }}
          />
        ))}
        {/* As wide as its cap, so nothing in it sticks out sideways; the line runs down its middle. */}
        <span
          data-slot="playhead"
          className="pointer-events-none absolute top-2 bottom-2 flex w-2 -translate-x-1/2 justify-center"
          style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${PLAYHEAD})` }}
        >
          <span className="h-full w-0.5 rounded-pill bg-playhead" />
          <span className="absolute -top-1 left-0 size-2 rounded-pill bg-playhead" />
        </span>
      </div>
      <figcaption>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          <Meaning kind="beat">
            <Trans>Every cut lands on the reel’s beat, to the frame.</Trans>
          </Meaning>
          <Meaning kind="ai">
            <Trans>The agent shows its plan before it changes anything.</Trans>
          </Meaning>
          <Meaning kind="you">
            <Trans>You can swap any clip it picks.</Trans>
          </Meaning>
        </ul>
      </figcaption>
    </figure>
  );
}
