// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: page bones (a page's shape while its code loads) · genre: atmospheric studio app (chrome
 * modern-minimal) · system: DESIGN.md v0.3 · bones are solid `hover` blocks whose pulse is the tc-bone class
 * (2.4 s under reduced motion, never stopped); no entrance: they are there when the page opens. Each shape keeps
 * its page's frame on the page grid (UX4: standard rows, the wide library, the reading chat; the editor edge to
 * edge, off the grid), so the real page lands where its bones were and the bar's title is already on its edge. */
import { cn } from '@taalcut/ui';
import type { CSSProperties } from 'react';
import { PageColumn } from '../shell/page';
import type { PageShape } from './page-place';

/** One bone. Width as a CSS length, so lines can be ragged like real text. */
export function Bone({ className, width }: { className?: string; width?: string }) {
  return (
    <span
      aria-hidden
      data-slot="bone"
      className={cn('tc-bone block shrink-0 rounded-sm bg-hover', className)}
      style={width ? ({ width } as CSSProperties) : undefined}
    />
  );
}

/** Row widths: a title and its line, ragged like real names. */
const ROWS: readonly (readonly [string, string])[] = [
  ['11rem', '19rem'],
  ['8.5rem', '23rem'],
  ['13rem', '16rem'],
  ['9.5rem', '21rem'],
];

/** Settings, Make, Templates and every detail page: the description, then a section of hairline rows. */
function RowsBones() {
  return (
    <PageColumn className="flex flex-col gap-8 pt-6 pb-10">
      <div className="flex h-6 items-center">
        <Bone className="h-3.5" width="min(34rem, 64%)" />
      </div>
      <div className="flex flex-col gap-2.5">
        <Bone className="h-4" width="10rem" />
        <Bone className="h-3" width="min(27rem, 52%)" />
        <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-rule-subtle rounded-lg border border-rule-subtle p-0">
          {ROWS.map(([title, line]) => (
            <li key={title} className="flex items-center gap-4 px-4 py-3.5">
              <span className="flex min-w-0 flex-1 flex-col gap-2">
                <Bone className="h-3.5" width={title} />
                <Bone className="h-3" width={`min(${line}, 80%)`} />
              </span>
              <Bone className="h-8 w-20 rounded-md" />
            </li>
          ))}
        </ul>
      </div>
    </PageColumn>
  );
}

/** The library: its search field, the filter chips and the clip count, then a grid of 9:16 tiles. */
function GridBones() {
  return (
    <PageColumn width="wide" className="flex flex-col gap-6 pt-6 pb-10">
      <div className="flex flex-col gap-3">
        <Bone className="h-11 w-full rounded-lg" />
        <div className="flex items-center gap-2">
          {['5rem', '5.5rem', '6rem', '5rem', '5.5rem'].map((width, i) => (
            <Bone key={i} className="h-8 rounded-pill" width={width} />
          ))}
          <Bone className="ms-auto h-3.5" width="5rem" />
          <Bone className="h-8 rounded-pill" width="8.5rem" />
        </div>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 p-0">
        {Array.from({ length: 12 }, (_, i) => (
          <li key={i} className="flex flex-col gap-2">
            <Bone className="aspect-[9/16] w-full rounded-md" />
            <span className="flex justify-between">
              <Bone className="h-3" width="2rem" />
              <Bone className="h-3" width="2.75rem" />
            </span>
          </li>
        ))}
      </ul>
    </PageColumn>
  );
}

/** The editor: the viewer with the inspector beside it, then the ruler and three tracks, edge to edge. */
function EditorBones() {
  return (
    <div className="flex min-h-full w-full flex-1 flex-col gap-4 px-6 pt-4 pb-6">
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_17rem] gap-4">
        <Bone className="aspect-video w-full rounded-lg" />
        <div className="flex flex-col gap-3 pt-1">
          <Bone className="h-4" width="7rem" />
          {['80%', '64%', '72%', '56%'].map((width) => (
            <Bone key={width} className="h-3" width={width} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-rule-subtle p-3">
        <Bone className="h-3 w-full rounded-clip" />
        {['92%', '74%', '58%'].map((width) => (
          <Bone key={width} className="h-10 rounded-clip" width={width} />
        ))}
      </div>
    </div>
  );
}

/** A new chat: its centred column, the first line and the composer. */
function ChatBones() {
  return (
    <PageColumn width="reading" className="flex flex-1 flex-col justify-center gap-5 py-10">
      <Bone className="h-6" width="min(22rem, 70%)" />
      <Bone className="h-3.5" width="min(30rem, 86%)" />
      <Bone className="mt-2 h-28 w-full rounded-2xl" />
      <span className="flex gap-2">
        {['9rem', '11rem', '8rem'].map((width) => (
          <Bone key={width} className="h-8 rounded-pill" width={width} />
        ))}
      </span>
    </PageColumn>
  );
}

/** The bones of a page of this shape. */
export function PageBones({ shape }: { shape: PageShape }) {
  switch (shape) {
    case 'grid':
      return <GridBones />;
    case 'editor':
      return <EditorBones />;
    case 'chat':
      return <ChatBones />;
    case 'rows':
      return <RowsBones />;
  }
}
