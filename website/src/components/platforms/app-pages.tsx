// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: platform app pages · what each platform's app window shows: Make on a Mac (a pasted reel link, its
 *   template and the slots filled), Make on Ubuntu (the reel dropped in as a file, the camera roll it fills from)
 * mode: Persuade (the product surface) · system: WEB2 Remix Vernacular (the coded app window; violet the AI's picks,
 *   rose the music beats, teal yours; no marigold inside a window: the page's one fill is Download for Mac)
 * states: static drawings of the app, read as text by assistive technology inside the window's named group; nothing
 *   here is a control. Laid out at the window's design width in design px (AppWindow scales it as one unit).
 * The reel and the clips are the owner's own (content/reels): its slots, music beats and frames from the roll's atlas. */

import { AudioLines, Check, FileVideo, Link2, RectangleVertical, type LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { BrandIcon } from '#components/brand/brand-icon';
import { SegmentBar } from '#components/ui/segment-bar';
import type { Segment } from '#components/ui/segment-bar';
import { PLATFORMS_PAGE } from '#content/platforms';
import { CAMERA_ROLL, DEFAULT_REEL_ID, reelById, smallPoster } from '#content/reels';
import type { SlotRole } from '#content/schema';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';

const APP = PLATFORMS_PAGE.app;
const reel = reelById(DEFAULT_REEL_ID);
const segments: Segment[] = reel.slots.map((s) => ({
  start: s.start,
  end: s.end,
  group: s.role,
  unsure: s.uncertainCut,
}));
const PART: Readonly<Record<SlotRole, string>> = {
  hook: 'Hook',
  build: 'Build',
  peak: 'Peak',
  outro: 'Outro',
};

/** One frame of the camera roll's atlas, as a 9:16 thumbnail. */
export function RollThumb({
  sprite,
  className,
  children,
}: {
  readonly sprite: number;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  const { columns, rows, src } = CAMERA_ROLL.atlas;
  const col = sprite % columns;
  const row = Math.floor(sprite / columns);
  const style: CSSProperties = {
    backgroundImage: `url(${src})`,
    backgroundSize: `${columns * 100}% ${Math.max(rows, 1) * 100}%`,
    backgroundPosition: `${columns > 1 ? (col / (columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
  };
  return (
    <span
      aria-hidden
      className={cn('relative block aspect-[9/16] shrink-0 overflow-hidden rounded-md bg-viewer', className)}
      style={style}
    >
      {children}
    </span>
  );
}

function spriteOf(clipId: string): number {
  return CAMERA_ROLL.clips.find((c) => c.id === clipId)?.sprite ?? 0;
}

function seconds(s: number): string {
  return `0:${s.toFixed(1).padStart(4, '0')}`;
}

function Fact({
  icon: Icon,
  tone,
  children,
}: {
  readonly icon: LucideIcon;
  readonly tone: string;
  readonly children: ReactNode;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 type-label', tone)}>
      <Icon aria-hidden strokeWidth={ICON_STROKE} className="size-4 shrink-0" />
      {children}
    </span>
  );
}

/** The template's facts and its segment bar, the same on every platform. */
function Template() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Fact icon={AudioLines} tone="text-rose-strong">
          {APP.beats(reel.beats.length)}
        </Fact>
        <Fact icon={RectangleVertical} tone="text-violet-strong">
          {APP.slots(reel.slots.length)}
        </Fact>
      </div>
      <SegmentBar segments={segments} beats={reel.beats} state="filled" tone="surface" labels numbers />
    </>
  );
}

/** How sure the AI is: the word beside a three-step meter in neutral ink, as the app's cast grid shows it. */
function Sure() {
  return (
    <span className="inline-flex items-center gap-1.5 type-meta text-ink-2">
      <span aria-hidden className="inline-flex items-end gap-0.5">
        {['h-1.5', 'h-2.5', 'h-3.5'].map((h) => (
          <span key={h} className={cn('w-1 rounded-sm bg-ink-2', h)} />
        ))}
      </span>
      {APP.sure}
    </span>
  );
}

function AiPick() {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-violet-soft px-2.5 py-1 type-meta font-semibold text-violet-strong">
      <AiMark className="size-3.5" />
      {APP.aiPick}
    </span>
  );
}

/** Make on a Mac: the pasted reel link, the template, the first slots filled, and the one approval. */
export function MacMake() {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-4 p-5">
        <div
          data-slot="icon-text"
          className="flex h-10 items-center gap-2 rounded-lg border border-rule bg-raised px-3 type-label text-ink-2"
        >
          <Link2 aria-hidden strokeWidth={ICON_STROKE} className="size-4 shrink-0 text-ink-3" />
          <BrandIcon id="instagram" className="size-4" />
          <span className="min-w-0 flex-1 truncate">{APP.link}</span>
          <Check aria-hidden strokeWidth={ICON_STROKE} className="size-4 text-teal-strong" />
        </div>
        <Template />
      </div>
      <ul className="m-0 list-none border-t border-rule-subtle p-0">
        {reel.slots.slice(0, 3).map((slot, i) => (
          <li key={slot.id} className="flex items-center gap-3 border-b border-rule-subtle px-5 py-2.5">
            <span className="w-4 type-label text-ink-3">{i + 1}</span>
            <RollThumb sprite={spriteOf(slot.pick.clipId)} className="w-9" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-baseline gap-2">
                <span className="type-label font-semibold text-ink">
                  Slot {i + 1} ({PART[slot.role]})
                </span>
                <span className="type-timecode text-ink-3">{seconds(slot.end - slot.start)}</span>
              </span>
              <span className="truncate type-meta text-ink-2">{slot.needs}</span>
            </span>
            <AiPick />
            <Sure />
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <span className="inline-flex items-center gap-1.5 type-label text-violet-strong">
          <AiMark className="size-4" />
          {APP.filled(reel.slots.length)}
        </span>
        <span className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-inverse px-4 type-label font-semibold text-on-inverse">
          <Check aria-hidden strokeWidth={ICON_STROKE + 0.5} className="size-4" />
          {APP.approve}
        </span>
      </div>
    </div>
  );
}

/** Make on Ubuntu: the reel dropped in as a file (a link isn't there yet), the template, the roll it fills from. */
export function UbuntuMake() {
  const poster = smallPoster(reel.id);
  const picked = new Set(reel.slots.map((s) => spriteOf(s.pick.clipId)));
  const roll = CAMERA_ROLL.clips.slice(0, 10);
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-teal-strong bg-teal-soft p-3">
        <span className="inline-grid size-10 shrink-0 place-items-center rounded-lg bg-raised text-teal-strong shadow-sm">
          <FileVideo aria-hidden strokeWidth={ICON_STROKE} className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="type-label font-semibold text-ink">{APP.drop}</span>
          <span className="type-meta text-ink-2">{APP.dropLine}</span>
        </span>
        <span
          data-slot="dropped-file"
          className="inline-flex shrink-0 rotate-[-4deg] items-center gap-2 rounded-lg bg-raised p-1.5 pe-3 shadow-sticker"
        >
          {poster ? (
            <span
              aria-hidden
              className="block h-10 w-6 rounded-sm bg-viewer bg-cover bg-center"
              style={{ backgroundImage: `url(${poster})` }}
            />
          ) : null}
          <span className="type-meta font-semibold text-ink">{APP.file}</span>
        </span>
      </div>
      <Template />
      <div className="flex flex-col gap-2">
        <span className="type-label text-ink-2">{APP.roll}</span>
        <div className="grid grid-cols-10 gap-1.5">
          {roll.map((clip) => {
            const pick = picked.has(clip.sprite);
            return (
              <RollThumb
                key={clip.id}
                sprite={clip.sprite}
                className={cn('w-full', pick && 'ring-2 ring-violet ring-offset-1 ring-offset-canvas')}
              >
                {pick ? (
                  <span className="absolute end-0.5 top-0.5 inline-grid size-4 place-items-center rounded-full bg-violet text-violet-ink">
                    <AiMark className="size-2.5" />
                  </span>
                ) : null}
              </RollThumb>
            );
          })}
        </div>
      </div>
    </div>
  );
}
