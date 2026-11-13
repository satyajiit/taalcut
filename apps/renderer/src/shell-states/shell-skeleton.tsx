// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: shell skeleton (the app's or Settings' sidebar and the page, while their code loads)
 * genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3 "Window" · the sidebar's own
 * colour and edge at its own width (240 px open, the 56 px rail when folded, as remembered), so the window bar's
 * band already lines up; rows as bones at the rows' height. Not interactive: no eight states. */
import { cn } from '@taalcut/ui';
import { useMatch } from '@tanstack/react-router';
import { useSidebarCollapsed, useSidebarMounted } from '../shell/sidebar-state';
import { Bone } from './page-bones';
import { PageSkeleton } from './page-skeleton';

/** A sidebar row: its icon, and its label unless the sidebar is the rail. */
function RowBone({ rail, label }: { rail: boolean; label: string }) {
  return (
    <span className={cn('flex h-9 items-center gap-3', rail ? 'justify-center' : 'px-2.5')}>
      <Bone className="size-4 rounded-sm" />
      {rail ? null : <Bone className="h-3" width={label} />}
    </span>
  );
}

/** Label widths for each kind of sidebar, in its order: what the real rows' words take. */
const ROWS = {
  app: { top: ['5.5rem', '3rem', '3.75rem', '5rem', '3.25rem'], list: ['7rem', '6.5rem', '8rem'] },
  settings: { top: ['6rem', '5.5rem'], list: ['3.5rem', '4.5rem', '6.5rem', '4rem', '5rem', '3.75rem'] },
} as const;

function SidebarBones({ kind }: { kind: keyof typeof ROWS }) {
  const rail = useSidebarCollapsed();
  // A sidebar is on screen: the bar shows its band, and the page grid starts after it, as it will.
  useSidebarMounted();
  const rows = ROWS[kind];
  return (
    <div
      aria-hidden
      data-slot="sidebar-skeleton"
      className={cn(
        'relative flex shrink-0 flex-col gap-3 bg-sidebar px-2 pt-2 pb-3',
        rail ? 'w-14' : 'w-60',
      )}
    >
      <span className="flex flex-col gap-0.5">
        {rows.top.map((label) => (
          <RowBone key={label} rail={rail} label={label} />
        ))}
      </span>
      <span className="h-px bg-rule opacity-60" />
      {rail ? null : (
        <span className="flex flex-col gap-0.5">
          <span className="flex h-7 items-center px-2.5">
            <Bone className="h-2.5" width="5rem" />
          </span>
          {rows.list.map((label) => (
            <RowBone key={label} rail={rail} label={label} />
          ))}
        </span>
      )}
      <span className="absolute inset-y-0 right-0 w-px bg-sidebar-border" />
    </div>
  );
}

/**
 * A layout's pending view: the shell (sidebar, page) while the shell's own code loads at launch, or Settings'
 * (its sections, the section) on the way into Settings. Every other page's is the page skeleton alone.
 */
export function PagePending() {
  // The pending view renders inside its own route's match: which layout, or page, is on its way.
  const routeId = useMatch({ strict: false, select: (match) => match.routeId });
  if (routeId !== '/_shell' && routeId !== '/settings') return <PageSkeleton />;
  return (
    <div className="flex h-full overflow-hidden bg-canvas text-ink">
      <SidebarBones kind={routeId === '/settings' ? 'settings' : 'app'} />
      <div className="flex min-w-0 flex-1 overflow-hidden">
        <PageSkeleton />
      </div>
    </div>
  );
}
