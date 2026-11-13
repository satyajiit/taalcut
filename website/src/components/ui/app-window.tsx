// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: app window · mode: Persuade (the product surface) · system: WEB2 Remix Vernacular
 * states: mac (traffic lights at the left of the bar) · ubuntu (GNOME's minimise, maximise and close at the right) ·
 *   with the sidebar (Make, Library, Templates, Agent, Settings; one area current) · compact sidebar · without it ·
 *   scaled (narrower than its design width, it shrinks as one unit: never a reflow) · folded (fit fold, on a phone:
 *   the sidebar folds away and the window lays out at its page's width) · fluid (fit fluid: it lays out at its own
 *   width from 320 design px, the sidebar only once the window is 60rem wide) · the window's own controls are
 *   drawings, not buttons (aria-hidden, no hover or focus); what the page puts inside carries its own states
 * The coded Taalcut desktop window, recreated from docs/design/window.md and the app's window bar (read, never
 * imported): a 52 px bar on the page's colour with the Avartan mark and the title, the sidebar a step below, the page.
 * Labelled as a demonstration of the app. Lay the page out with the spacing, text and radius scales (p-4, type-body,
 * rounded-lg, size-4 icons): inside the window they are design pixels that scale with it (globals.css, --aw-px). */

import { AudioWaveform, FolderOpen, Minus, Settings, Square, Wand, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { Logo } from '#components/brand/logo';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';

export type AppArea = 'products' | 'create' | 'make' | 'library' | 'templates' | 'agent' | 'settings';
export type AppWindowSize = 'sm' | 'md' | 'lg';

/** The design width each size lays out at, in px; narrower than this, the window scales down whole. */
export const APP_WINDOW_WIDTH: Readonly<Record<AppWindowSize, number>> = { sm: 560, md: 760, lg: 960 };

/** The sidebar's design width, full and compact; a compact sidebar narrows the window by the difference. */
export const APP_SIDEBAR_WIDTH = { full: 200, compact: 160 } as const;

/**
 * How a window meets a narrow screen (world.css does the work, so the server HTML and the page agree):
 * - scale: it lays out at its design width and shrinks as one unit below it (the default);
 * - fold: below 640 px of screen the sidebar folds away and the window lays out at its page's width (its design
 *   width less the full sidebar's), so the page shrinks less on a phone;
 * - fluid: it lays out at its own width from 320 design px up (shrinking only below that), and the sidebar shows
 *   only once the window is 60rem wide: a showcase that stays usable on a phone.
 */
export type AppWindowFit = 'scale' | 'fold' | 'fluid';

/**
 * The app's areas, as its sidebar shows them (apps/renderer/src/shell/areas.ts, WEB3: Products and Create joined), each
 * with its glyph and the colour its icon takes when current. Create's glyph is the wand without the app's sparkles
 * (the site never draws a sparkle).
 */
export const APP_AREAS: readonly { readonly id: AppArea; readonly label: string; readonly icon: LucideIcon | 'ai'; readonly current: string }[] = [
  { id: 'products', label: 'Products', icon: FolderOpen, current: 'text-teal-strong' },
  { id: 'create', label: 'Create', icon: Wand, current: 'text-marigold-strong' },
  { id: 'make', label: 'Make', icon: ICONS.make, current: 'text-marigold-strong' },
  { id: 'library', label: 'Library', icon: ICONS.clip, current: 'text-teal-strong' },
  { id: 'templates', label: 'Templates', icon: AudioWaveform, current: 'text-rose-strong' },
  { id: 'agent', label: 'Agent', icon: 'ai', current: 'text-violet-strong' },
  { id: 'settings', label: 'Settings', icon: Settings, current: 'text-ink' },
];

export interface AppWindowProps {
  readonly title: string;
  readonly platform?: 'mac' | 'ubuntu';
  /** The sidebar: full (true, the default), 'compact' (narrower, the window with it), or none (false). */
  readonly sidebar?: boolean | 'compact';
  /** How it meets a narrow screen: scale (default), fold or fluid (AppWindowFit). */
  readonly fit?: AppWindowFit;
  /** The current area in the sidebar. */
  readonly area?: AppArea;
  readonly size?: AppWindowSize;
  /** What the window's bar shows at its right end, before Ubuntu's controls (a page action, a count). */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  /** The page's own class: padding, layout. */
  readonly pageClassName?: string;
}

function MacLights() {
  return (
    <span aria-hidden data-slot="app-window-controls" className="flex items-center gap-2">
      {(['bg-window-close', 'bg-window-minimize', 'bg-window-zoom'] as const).map((c) => (
        <span key={c} className={cn('size-3 rounded-full ring-1 ring-ink/10 ring-inset', c)} />
      ))}
    </span>
  );
}

function GnomeControls() {
  return (
    <span aria-hidden data-slot="app-window-controls" className="flex items-center gap-3">
      {[Minus, Square, X].map((Glyph, i) => (
        <span key={i} className={cn('inline-grid size-6 place-items-center rounded-full', i === 2 ? 'bg-control-pressed text-ink' : 'bg-control text-ink-2')}>
          <Glyph strokeWidth={ICON_STROKE + 0.5} className={i === 1 ? 'size-2.5' : 'size-3.5'} />
        </span>
      ))}
    </span>
  );
}

function Sidebar({ area, compact }: { readonly area: AppArea; readonly compact: boolean }) {
  const rows = APP_AREAS.filter((a) => a.id !== 'settings');
  const settings = APP_AREAS.find((a) => a.id === 'settings')!;
  const row = (a: (typeof APP_AREAS)[number]) => {
    const current = a.id === area;
    const Glyph = a.icon;
    return (
      <li
        key={a.id}
        data-area={a.id}
        data-current={current || undefined}
        className={cn('flex h-9 items-center gap-2.5 rounded-lg px-2.5 type-label', current ? 'bg-raised text-ink shadow-sm' : 'text-ink-2')}
      >
        <span aria-hidden className={cn('inline-flex size-4 shrink-0', current ? a.current : 'text-ink-3')}>
          {Glyph === 'ai' ? <AiMark className="size-4" /> : <Glyph strokeWidth={ICON_STROKE} className="size-4" />}
        </span>
        {a.label}
      </li>
    );
  };
  return (
    // Its display is world.css's (a fold or a fluid window hides it), so no display class here.
    <div
      data-slot="app-window-sidebar"
      className={cn('shrink-0 flex-col justify-between border-r border-rule-subtle bg-sidebar p-3', compact ? 'w-40' : 'w-50')}
    >
      <ul className="flex flex-col gap-1">{rows.map(row)}</ul>
      <ul className="mt-6 flex flex-col gap-1 border-t border-rule-subtle pt-3">{row(settings)}</ul>
    </div>
  );
}

export function AppWindow({
  title,
  platform = 'mac',
  sidebar = true,
  fit = 'scale',
  area = 'make',
  size = 'md',
  actions,
  children,
  className,
  pageClassName,
}: AppWindowProps) {
  return (
    <div
      role="group"
      aria-label={`A demonstration of the Taalcut app: ${title}`}
      data-slot="app-window"
      data-size={size}
      data-fit={fit === 'scale' ? undefined : fit}
      data-sidebar={sidebar === false ? undefined : sidebar === 'compact' ? 'compact' : 'full'}
      data-platform={platform}
      className={cn('w-full', className)}
    >
      <div data-slot="app-window-frame" className="overflow-hidden rounded-window bg-canvas text-ink shadow-window">
        <div data-slot="app-window-bar" className="flex h-13 items-center gap-3 border-b border-rule-subtle bg-canvas px-4">
          {platform === 'mac' ? <MacLights /> : null}
          <span className={cn('flex min-w-0 flex-1 items-center gap-2.5', platform === 'mac' && 'ps-3')}>
            <Logo kind="symbol" className="size-4 shrink-0" />
            <span className="truncate type-label font-semibold text-ink">{title}</span>
          </span>
          {actions ? <span className="flex shrink-0 items-center gap-2">{actions}</span> : null}
          {platform === 'ubuntu' ? <GnomeControls /> : null}
        </div>
        <div className="flex min-h-0">
          {sidebar ? <Sidebar area={area} compact={sidebar === 'compact'} /> : null}
          <div data-slot="app-window-page" className={cn('min-w-0 flex-1', pageClassName)}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
