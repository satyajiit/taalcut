// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.window: the window a page lives in. The app draws its own
 * window bar and traffic controls (the system ones are hidden), so the page
 * asks main to close, minimise, zoom or toggle full screen, and follows the
 * window's state to draw them: focused or not, zoomed, full screen, and what
 * a double-click on the bar does (the macOS setting in System Settings ›
 * Desktop & Dock). Every call acts on the caller's own window only: main
 * resolves it from the connection, never from anything the page sends. The
 * one exception is Option-click on close or minimise, which acts on every
 * window of the app, as on macOS.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { NotFoundError } from '../basics/errors';
import { eventIterator, implementContract, ipc } from './contract';
import { toRpcError } from './errors';

/** What a double-click on the window bar does, as macOS names it (AppleActionOnDoubleClick). */
export const DOUBLE_CLICK_ACTIONS = ['maximize', 'minimize', 'none'] as const;
export type DoubleClickAction = (typeof DOUBLE_CLICK_ACTIONS)[number];

export const windowStateSchema = z.object({
  /** The window has keyboard focus: the controls show their colours. */
  focused: z.boolean(),
  /** Zoomed to fill the screen (macOS "zoom"); not full screen. */
  maximized: z.boolean(),
  minimized: z.boolean(),
  /** In its own full-screen Space: the bar stays, the controls hide. */
  fullScreen: z.boolean(),
  /** Unsaved changes (macOS "document edited"): the close control shows a dot. */
  edited: z.boolean(),
  doubleClick: z.enum(DOUBLE_CLICK_ACTIONS),
});
export type WindowState = z.output<typeof windowStateSchema>;

const windowScopeSchema = z.object({ allWindows: z.boolean().optional() }).optional();

export const windowContract = {
  /** This window's state now. */
  state: ipc.output(windowStateSchema),
  /** The current state first, then every change, until the caller stops. */
  changed: ipc.output(eventIterator(windowStateSchema)),
  /** `allWindows`: Option-click, every window of the app. */
  close: ipc.input(windowScopeSchema).output(z.void()),
  minimize: ipc.input(windowScopeSchema).output(z.void()),
  /** Zooms, or back from zoomed (the green control with Option held). */
  zoom: ipc.output(z.void()),
  toggleFullScreen: ipc.output(z.void()),
  /** What a double-click on the bar should do, per the system setting: zoom, minimise or nothing. */
  doubleClick: ipc.output(z.void()),
  /** Marks the window as having unsaved changes, or not (BrowserWindow.setDocumentEdited). */
  setEdited: ipc.input(z.object({ edited: z.boolean() })).output(z.void()),
};

/** One window as main sees it, minus Electron (main adapts a BrowserWindow to this). */
export interface WindowService {
  state(): WindowState;
  /** Every state change. Returns an unsubscribe function. */
  subscribe(listener: (state: WindowState) => void): () => void;
  /** `allWindows`: every window of the app (Option-click). */
  close(options?: { allWindows?: boolean }): void;
  minimize(options?: { allWindows?: boolean }): void;
  zoom(): void;
  toggleFullScreen(): void;
  setEdited(edited: boolean): void;
}

/** Runs the system's double-click action on a window. */
export function runDoubleClick(window: WindowService): void {
  const action = window.state().doubleClick;
  if (action === 'maximize') window.zoom();
  else if (action === 'minimize') window.minimize();
}

/**
 * The value of macOS's AppleActionOnDoubleClick as an action. Unset means
 * the default, which zooms; macOS 15 also writes "Fill" for zooming.
 */
export function doubleClickAction(value: string | null | undefined): DoubleClickAction {
  if (value === 'Minimize') return 'minimize';
  if (value === 'None') return 'none';
  return 'maximize';
}

/** The current state, then each change (only the latest if several arrive at once), until `signal` fires. */
async function* windowChanges(window: WindowService, signal?: AbortSignal): AsyncGenerator<WindowState> {
  let pending: WindowState | undefined = window.state();
  let wake: (() => void) | undefined;
  const off = window.subscribe((state) => {
    pending = state;
    wake?.();
  });
  const onAbort = (): void => wake?.();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (!signal?.aborted) {
      if (pending) {
        const next: WindowState = pending;
        pending = undefined;
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => (wake = resolve));
      wake = undefined;
    }
  } finally {
    off();
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Only `{ allWindows: true }` widens a call; anything else is this window. */
function scope(input: { allWindows?: boolean | undefined } | undefined): { allWindows?: boolean } {
  return input?.allWindows ? { allWindows: true } : {};
}

/**
 * Serves windowContract for the caller's own window: `windowFor` maps the
 * connection's context (main's renderer context names the web contents) to
 * that window, or null once it is gone.
 */
export function windowRouter<TContext extends object>(
  windowFor: (context: TContext) => WindowService | null,
) {
  const os = implementContract(windowContract).$context<TContext>();
  const own = (context: TContext): WindowService => {
    const window = windowFor(context);
    if (!window) throw toRpcError(NotFoundError({ entity: 'window' }));
    return window;
  };
  return os.router({
    state: os.state.handler(({ context }) => own(context).state()),
    changed: os.changed.handler(({ context, signal }) => windowChanges(own(context), signal)),
    close: os.close.handler(({ context, input }) => own(context).close(scope(input))),
    minimize: os.minimize.handler(({ context, input }) => own(context).minimize(scope(input))),
    zoom: os.zoom.handler(({ context }) => own(context).zoom()),
    toggleFullScreen: os.toggleFullScreen.handler(({ context }) => own(context).toggleFullScreen()),
    doubleClick: os.doubleClick.handler(({ context }) => runDoubleClick(own(context))),
    setEdited: os.setEdited.handler(({ context, input }) => own(context).setEdited(input.edited)),
  });
}
