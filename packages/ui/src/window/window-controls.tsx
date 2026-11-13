// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: window controls (traffic lights) · genre: atmospheric studio app · theme: custom "golden hour, on the beat" (DESIGN.md v0.2)
 * states: default · hover (the group) · active (pressed) · inactive window · disabled · focus (assistive tech only)
 *   loading · error · success: none. A window control has no such states; the window moving is the answer.
 * contrast: glyph on disc 3.3–5.3 (ui floor 3, design/contrast-report.md)
 * gate 47 (re-drawn chrome): not fake chrome. These are the window's only controls (the system lights are hidden, PO decision).
 */
import { useLingui } from '@lingui/react/macro';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '#lib/cn';

export type WindowControlKind = 'close' | 'minimize' | 'zoom';
/** What the third control does: full screen by default, zoom with Option held. */
export type WindowAction = 'close' | 'minimize' | 'zoom' | 'fullScreen';

/*
 * Our drawing of the macOS traffic lights, in their own tokens
 * (--color-window-close, -minimize, -zoom and their -ink glyphs, tuned to the
 * macOS hues; one edit in design/tokens/source.mjs moves them). Each is a 14 px
 * disc with a fine rim of its own ink, inside a 24 px target. When the window
 * is not the active one the discs turn a flat neutral grey; pointing at them
 * brings the colour back, as on macOS.
 */
const DISC: Record<WindowControlKind, string> = {
  close: cn(
    'bg-window-close text-window-close-ink ring-window-close-ink/20',
    'window-inactive:group-hover/controls:bg-window-close window-inactive:in-[.is-hover]:bg-window-close',
    'window-inactive:group-hover/controls:ring-window-close-ink/20 window-inactive:in-[.is-hover]:ring-window-close-ink/20',
  ),
  minimize: cn(
    'bg-window-minimize text-window-minimize-ink ring-window-minimize-ink/20',
    'window-inactive:group-hover/controls:bg-window-minimize window-inactive:in-[.is-hover]:bg-window-minimize',
    'window-inactive:group-hover/controls:ring-window-minimize-ink/20 window-inactive:in-[.is-hover]:ring-window-minimize-ink/20',
  ),
  zoom: cn(
    'bg-window-zoom text-window-zoom-ink ring-window-zoom-ink/20',
    'window-inactive:group-hover/controls:bg-window-zoom window-inactive:in-[.is-hover]:bg-window-zoom',
    'window-inactive:group-hover/controls:ring-window-zoom-ink/20 window-inactive:in-[.is-hover]:ring-window-zoom-ink/20',
  ),
};

/*
 * The macOS glyphs, on the 14-unit grid of the disc: ×, − and + are 1.25 px
 * strokes; full screen is two filled triangles pointing out to the corners
 * (in to the middle to leave it).
 */
const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round' } as const;
const SOLID = { fill: 'currentColor' } as const;
const GLYPHS = {
  close: <path {...LINE} d="M4.75 4.75l4.5 4.5m0-4.5l-4.5 4.5" />,
  minimize: <path {...LINE} d="M3.75 7h6.5" />,
  zoom: <path {...LINE} d="M7 3.75v6.5M3.75 7h6.5" />,
  fullScreen: <path {...SOLID} d="M4.5 4.5h3.75L4.5 8.25zM9.5 9.5H5.75L9.5 5.75z" />,
  exitFullScreen: <path {...SOLID} d="M6.25 6.25v-3.5l-3.5 3.5zM7.75 7.75v3.5l3.5-3.5z" />,
} as const;

type GlyphName = keyof typeof GLYPHS;

export interface WindowControlProps extends Omit<ComponentProps<'button'>, 'children'> {
  kind: WindowControlKind;
  /** The translated name: "Close window", "Zoom window"… */
  label: string;
  glyph: GlyphName;
  /** Unsaved changes: the close control shows a dot until it is pointed at. */
  edited?: boolean;
}

/** One traffic control. Use WindowControls; this is exported for the state preview. */
export function WindowControl({
  kind,
  label,
  glyph,
  edited = false,
  className,
  ...props
}: WindowControlProps) {
  return (
    <button
      type="button"
      // Not in the tab order: ⌘W, ⌘M and ⌃⌘F do the same from the keyboard (menu).
      tabIndex={-1}
      aria-label={label}
      data-slot="window-control"
      data-kind={kind}
      className={cn(
        'group/control app-no-drag relative flex size-6 shrink-0 items-center justify-center rounded-full',
        'cursor-default outline-none disabled:pointer-events-none',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-3.5 items-center justify-center rounded-full ring-1 ring-inset',
          // Fills ease; the focus outline never does (it is not in the list).
          'transition-[background-color,box-shadow] duration-(--dur-micro) ease-(--ease-out)',
          DISC[kind],
          // Pressed: disc and glyph darken together, as on macOS.
          'group-active/control:brightness-[0.8] in-[.is-active]:brightness-[0.8]',
          // Inactive window: a flat grey disc until pointed at (the colours above come back on hover).
          'window-inactive:bg-window-inactive window-inactive:ring-ink/10',
          // Disabled (no window behind the page): the same grey, whatever else applies.
          'group-disabled/control:bg-window-inactive! group-disabled/control:ring-ink/10!',
          // Focus reaches a control only from assistive tech (VoiceOver): the marigold ring, instant.
          'group-focus-visible/control:outline-(length:--rule-fine) group-focus-visible/control:outline-offset-2',
          'group-focus-visible/control:outline-focus group-focus-visible/control:outline-solid',
          'in-[.is-focus]:outline-(length:--rule-fine) in-[.is-focus]:outline-offset-2 in-[.is-focus]:outline-focus in-[.is-focus]:outline-solid',
          'window-inactive:group-focus-visible/control:outline-transparent',
        )}
      >
        <svg
          viewBox="0 0 14 14"
          className={cn(
            'size-3.5 opacity-0',
            // The glyphs show on all three when any is pointed at, pressed or focused; at once, as on macOS.
            'group-hover/controls:opacity-100 group-focus-within/controls:opacity-100',
            'in-[.is-hover]:opacity-100 in-[.is-focus]:opacity-100 in-[.is-active]:opacity-100',
            'group-disabled/control:opacity-0!',
          )}
        >
          {GLYPHS[glyph]}
        </svg>
        {edited ? (
          <span
            data-slot="window-edited-dot"
            className={cn(
              'absolute size-1.5 rounded-full bg-current',
              'window-inactive:bg-ink-3 group-disabled/control:bg-ink-3',
              'group-hover/controls:opacity-0 group-focus-within/controls:opacity-0 in-[.is-hover]:opacity-0',
            )}
          />
        ) : null}
      </span>
    </button>
  );
}

/** True while Option is held: the green control zooms instead of going full screen. */
function useOptionKey(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => setHeld(event.altKey);
    const reset = () => setHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', reset);
    };
  }, []);
  return held;
}

export interface WindowControlsProps {
  /** Unsaved changes in the window: a dot in the close control. */
  edited?: boolean;
  /** In full screen the third control leaves full screen. */
  fullScreen?: boolean;
  /**
   * Runs an action. `allWindows` is Option-click on close or minimise. Without
   * it the controls are drawn but inert (a page with no window behind it, such
   * as the plain-browser dev server).
   */
  onAction?: (action: WindowAction, options: { allWindows: boolean }) => unknown;
  className?: string;
  children?: ReactNode;
}

/**
 * Close, minimise and full screen (zoom with Option), our own drawing of the
 * macOS traffic lights. Hovering any shows all three glyphs; the group is
 * named "Window controls" for VoiceOver.
 */
export function WindowControls({
  edited = false,
  fullScreen = false,
  onAction,
  className,
  children,
}: WindowControlsProps) {
  const { t } = useLingui();
  const option = useOptionKey();
  const zoomAction: WindowAction = option && !fullScreen ? 'zoom' : 'fullScreen';
  const inert = !onAction;
  const run = (action: WindowAction, allWindows: boolean) => void onAction?.(action, { allWindows });
  const zoomLabel =
    zoomAction === 'zoom' ? t`Zoom window` : fullScreen ? t`Exit full screen` : t`Enter full screen`;

  return (
    <div
      role="group"
      aria-label={t`Window controls`}
      data-slot="window-controls"
      className={cn('group/controls app-no-drag flex items-center', className)}
    >
      <WindowControl
        kind="close"
        glyph="close"
        label={t`Close window`}
        edited={edited}
        disabled={inert}
        onClick={(event) => run('close', event.altKey)}
      />
      <WindowControl
        kind="minimize"
        glyph="minimize"
        label={t`Minimize window`}
        disabled={inert}
        onClick={(event) => run('minimize', event.altKey)}
      />
      <WindowControl
        kind="zoom"
        glyph={zoomAction === 'zoom' ? 'zoom' : fullScreen ? 'exitFullScreen' : 'fullScreen'}
        label={zoomLabel}
        disabled={inert}
        onClick={(event) => run(event.altKey && !fullScreen ? 'zoom' : zoomAction, false)}
      />
      {children}
    </div>
  );
}
