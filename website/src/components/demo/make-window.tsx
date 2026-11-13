// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Make window · mode: Persuade (the coded app, the hero's product surface) · system: WEB2 Remix Vernacular
 * The Taalcut app window on its Make page, remixing the saved reel: the sidebar folded to its icon rail (as the app
 * folds it), the template strip, four slot rows at a time, the camera roll as one line the clips fly from, and the one
 * Approve. Labelled as a demonstration (AppWindow); a live region says each step of the pass once.
 * states: waiting (no template: the strip's dashed place, the list says what fills it) · template (the strip lands
 *   from the reel, its music beats appear as they are read, the rows rise) · sift (the roll line's next clips wait on
 *   its stack) · picking (a clip leaves the stack per beat for its slot, a rose ring on its segment, the list steps
 *   down with it) · ready (every meter full, the list back at slot 1; Approve opens with a pop) · approved (Approve
 *   says Approved in teal, the strip follows Your version's clock) · Approve: unavailable (aria-disabled, dimmed,
 *   still focusable so a keyboard finds it) · hover · focus (base ring) · active (3 % give) · approved · narrow (under
 *   21 rem the rail folds away too) · reduced motion (the finished pass, 150 ms fades) · without JavaScript (waiting,
 *   every word there)
 * The window lays out at its own width, 1 px a design px from 320 up (fit fluid), so every row's words stay 13 px.
 * The status line keeps two lines' room: a status that wraps mid-pass ("Finding cuts and music beats") would
 *   otherwise grow the window and move the whole page under it. */

import { AudioLines, Check, CheckCheck, Images, RectangleVertical } from 'lucide-react';
import { motion, type MotionValue } from 'motion/react';
import type { CSSProperties, RefObject } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { APP_AREAS, AppWindow } from '#components/ui/app-window';
import { IconText } from '#components/ui/icon-text';
import type { CameraRoll, Reel } from '#content/schema';
import { cn } from '#lib/cn';
import { ICONS, ICON_STROKE } from '#lib/icons';
import { EASE_OUT, REDUCED_FADE } from '#lib/motion';
import type { DemoPhase } from '#stores/demo';
import { DEMO } from '#components/hero/copy';
import { liveLine, statusLine, type SlotRow } from './hero-model';
import { reached } from './pass';
import { formatCount } from './roll';
import { SlotList } from './slot-list';
import { TemplateBar } from './template-bar';

export interface MakeWindowProps {
  readonly reel: Reel;
  readonly roll: CameraRoll;
  readonly rows: readonly SlotRow[];
  /** Each slot's pick as its row's 3:4 thumbnail. */
  readonly thumbs: readonly CSSProperties[];
  readonly phase: DemoPhase;
  readonly landed: number;
  readonly read: number;
  /** The bar's flight has landed: the strip shows. */
  readonly barLanded: boolean;
  readonly arrived: ReadonlySet<number>;
  /** The last pick to land, for the rose ring on its segment. */
  readonly lastArrived: number;
  /** The strip's clock while picks land, and the reel's once approved. */
  readonly stripTime: MotionValue<number>;
  readonly reelTime: MotionValue<number>;
  readonly reduce: boolean;
  readonly listRef: RefObject<HTMLDivElement | null>;
  readonly onApprove: () => void;
  readonly className?: string;
}

/** The app's sidebar folded to its icon rail (packages/ui sidebar-fold): each area's glyph, Make current. */
function AreaRail() {
  const row = (a: (typeof APP_AREAS)[number]) => {
    const current = a.id === 'make';
    const Glyph = a.icon;
    return (
      <li
        key={a.id}
        data-area={a.id}
        data-current={current || undefined}
        className={cn('inline-grid size-8 place-items-center rounded-lg', current ? 'bg-raised shadow-sm' : 'text-ink-3')}
      >
        <span aria-hidden className={cn('inline-flex size-4', current && a.current)}>
          {Glyph === 'ai' ? <AiMark className="size-4" /> : <Glyph strokeWidth={ICON_STROKE} className="size-4" />}
        </span>
        <span className="sr-only">{a.label}</span>
      </li>
    );
  };
  return (
    <div data-slot="area-rail" className="hidden w-12 shrink-0 flex-col items-center justify-between border-r border-rule-subtle bg-sidebar py-3 @min-[21rem]:flex">
      <ul aria-label={DEMO.areas} className="flex flex-col items-center gap-1.5">
        {APP_AREAS.filter((a) => a.id !== 'settings').map(row)}
      </ul>
      <ul className="flex flex-col items-center">{APP_AREAS.filter((a) => a.id === 'settings').map(row)}</ul>
    </div>
  );
}

/** "Camera roll · 1,284 clips", with the roll's next clips fanned on a stack the flights leave from. */
function RollLine({ roll, thumbs, landed }: { readonly roll: CameraRoll; readonly thumbs: readonly CSSProperties[]; readonly landed: number }) {
  const next = [0, 1, 2].map((k) => thumbs[(landed + k) % Math.max(thumbs.length, 1)]);
  return (
    <div data-slot="roll-line" className="flex items-center gap-2 px-1">
      <IconText icon={Images} tone="you" className="type-label-sm font-semibold text-ink">
        {DEMO.roll}
      </IconText>
      <span aria-hidden className="type-label-sm text-ink-3">
        ·
      </span>
      <span className="type-label-sm font-semibold text-teal-strong tabular-nums">{DEMO.clips(formatCount(roll.shownCount))}</span>
      <span aria-hidden data-flight-from="roll" className="relative ms-auto h-7 w-10">
        {next.map((style, k) => (
          <span
            key={k}
            className="absolute top-0 aspect-[3/4] w-5 rounded-sm bg-sunken shadow-sm ring-1 ring-canvas"
            style={{ ...style, left: `${(2 - k) * 7}px`, rotate: `${(2 - k) * 6 - 6}deg`, zIndex: 3 - k }}
          />
        ))}
      </span>
    </div>
  );
}

function ApproveButton({ phase, reduce, onApprove }: { readonly phase: DemoPhase; readonly reduce: boolean; readonly onApprove: () => void }) {
  const ready = phase === 'ready';
  const approved = phase === 'approved';
  return (
    <motion.button
      type="button"
      data-slot="approve"
      aria-disabled={!ready || undefined}
      onClick={() => {
        if (ready) onApprove();
      }}
      initial={false}
      animate={ready && !reduce ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={{ duration: 0.42, ease: EASE_OUT }}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-4 type-label font-semibold whitespace-nowrap select-none',
        'transition-[background-color,color] duration-(--dur-micro) ease-(--ease-out)',
        ready && 'bg-inverse text-on-inverse hover:bg-inverse/85 active:scale-[0.97] motion-reduce:active:scale-100',
        approved && 'cursor-default bg-teal-soft text-teal-strong',
        !ready && !approved && 'cursor-not-allowed bg-control text-ink-disabled',
      )}
    >
      {approved ? <CheckCheck aria-hidden strokeWidth={ICON_STROKE} className="size-4" /> : <Check aria-hidden strokeWidth={ICON_STROKE} className="size-4" />}
      {approved ? DEMO.approved : DEMO.approve}
    </motion.button>
  );
}

export function MakeWindow(props: MakeWindowProps) {
  const { reel, roll, rows, thumbs, phase, landed, read, barLanded, arrived, lastArrived, stripTime, reelTime, reduce, listRef, onApprove, className } = props;
  const taken = reached(phase, 'template');
  const readAll = reached(phase, 'sift');
  const fade = { duration: reduce ? REDUCED_FADE : 0.3, ease: EASE_OUT };
  const stripState = phase === 'approved' ? 'playing' : phase === 'assembled' ? 'playing' : reached(phase, 'ready') ? 'filled' : 'idle';
  const beats = readAll ? reel.beats : reel.beats.slice(0, Math.max(read + 1, 0));

  return (
    <AppWindow title={reel.project ?? reel.title} area="make" size="sm" sidebar={false} fit="fluid" className={className} pageClassName="flex">
      <AreaRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 p-3">
          <div className="flex h-7 items-center justify-between gap-2">
            <p className="type-label font-semibold text-ink">{DEMO.page}</p>
            <span className="flex items-center gap-2.5">
              {readAll ? (
                <motion.span className="flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
                  <IconText icon={AudioLines} tone="beat" className="type-label-sm font-semibold text-rose-strong">
                    {DEMO.stickers.beats(reel.beats.length)}
                  </IconText>
                </motion.span>
              ) : null}
              {taken && barLanded ? (
                <motion.span className="flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
                  <IconText icon={RectangleVertical} tone="ai" className="type-label-sm font-semibold text-ink-2">
                    {DEMO.stickers.slots(reel.slots.length)}
                  </IconText>
                </motion.span>
              ) : null}
            </span>
          </div>

          <div className="relative flex h-15 items-center">
            {taken ? (
              <motion.div className="w-full" initial={{ opacity: 0 }} animate={{ opacity: barLanded ? 1 : 0 }} transition={{ duration: barLanded ? 0.15 : 0 }}>
                <TemplateBar
                  key={phase === 'approved' ? 'reel-clock' : 'strip-clock'}
                  reel={reel}
                  tone="surface"
                  state={stripState}
                  time={phase === 'approved' ? reelTime : stripTime}
                  beats={beats}
                  flight="to"
                  landing={phase === 'assembled' ? lastArrived : undefined}
                />
              </motion.div>
            ) : (
              <span data-slot="strip-empty" className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-rule-strong type-label-sm text-ink-3">
                <ICONS.template aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
                {DEMO.noTemplate}
              </span>
            )}
          </div>

          <SlotList ref={listRef} rows={taken ? rows : null} arrived={arrived} thumbs={thumbs} reduce={reduce} />
          <RollLine roll={roll} thumbs={thumbs} landed={landed} />
        </div>

        <div className="mt-auto flex items-center gap-3 border-t border-rule-subtle bg-panel px-3 py-2.5">
          <p data-slot="status" className="flex min-h-[2lh] min-w-0 flex-1 items-center gap-2 type-label-sm text-ink-2">
            {phase === 'approved' ? (
              <CheckCheck aria-hidden strokeWidth={ICON_STROKE} className="size-4 shrink-0 text-teal-strong" />
            ) : (
              <AiMark className="size-4 shrink-0 text-violet-strong" />
            )}
            <span>{statusLine(phase, landed, reel.slots.length, roll.shownCount)}</span>
          </p>
          <ApproveButton phase={phase} reduce={reduce} onApprove={onApprove} />
        </div>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-slot="pass-live">
        {liveLine(phase, reel.slots.length, reel.beats.length, roll.shownCount)}
      </p>
    </AppWindow>
  );
}
