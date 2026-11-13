// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keyboard shortcuts written as accelerators, the way Electron's menus write
 * them, in any case: 'mod+k', 'Mod+Shift+Z', 'mod+,'. `Mod` is ⌘ on a Mac and
 * Ctrl elsewhere (Electron's CmdOrCtrl). On a Mac keys show as its glyphs
 * (⌃ ⌥ ⇧ ⌘, in the Mac's order); on Linux and Windows as the words on the
 * keys (Ctrl, Alt, Shift, in the PC's order), translated, with arrows still
 * glyphs (DESIGN.md, "Shortcut keys"). Matching accepts ⌘ or Ctrl for `Mod`
 * everywhere.
 */
import type { HostPlatform } from '../platform/host-platform';

export interface Shortcut {
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  /** The key as written: 'K', '1', ',', 'Enter'. */
  readonly key: string;
}

export function parseShortcut(accelerator: string): Shortcut {
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  const has = (name: string) => parts.some((p) => p.toLowerCase() === name);
  return { mod: has('mod'), shift: has('shift'), alt: has('alt'), ctrl: has('ctrl'), key };
}

/** By key, or by physical key for letters and digits (Shift+1 reports '!', ⌥A reports 'å'). */
function sameKey(event: KeyboardEvent, key: string): boolean {
  const k = key.toLowerCase();
  const code = event.code.toLowerCase();
  return event.key.toLowerCase() === k || code === `key${k}` || code === `digit${k}`;
}

/** True when the event is this shortcut. */
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (!sameKey(event, shortcut.key)) return false;
  const modPressed = event.metaKey || (event.ctrlKey && !shortcut.ctrl);
  return (
    modPressed === shortcut.mod &&
    event.shiftKey === shortcut.shift &&
    event.altKey === shortcut.alt &&
    (!shortcut.ctrl || event.ctrlKey)
  );
}

/** By lower-case key name, so accelerators can be written 'mod+enter' or 'Mod+Enter'. */
const GLYPHS: Readonly<Record<string, string>> = {
  enter: '↩',
  escape: '⎋',
  backspace: '⌫',
  delete: '⌦',
  tab: '⇥',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

/** A Mac's menus show minus as the minus sign (View › Zoom Out, ⌘−); a PC's keep the hyphen on the key. */
const MAC_GLYPHS: Readonly<Record<string, string>> = { ...GLYPHS, '-': '−' };

/** The words on a PC's keys, translated (palette/key-words.ts): modifiers, and the named keys a PC labels in words. */
export type KeyWords = Readonly<
  Record<'ctrl' | 'alt' | 'shift' | 'enter' | 'escape' | 'backspace' | 'delete' | 'tab', string>
>;

/** Keys a PC labels with a word; the rest (arrows) keep their glyphs. */
const WORD_KEYS = new Set<keyof KeyWords>(['enter', 'escape', 'backspace', 'delete', 'tab']);

/**
 * The keys to show, one per <kbd>. A Mac, in its order: ['⇧', '⌘', 'Z']. A PC (`pc` with its words), Ctrl, Alt,
 * Shift, then the key: ['Ctrl', 'Shift', 'Z']; Mod and Ctrl are the same key there, shown once, as Electron's
 * CmdOrCtrl+Ctrl is.
 */
export function shortcutKeys(shortcut: Shortcut, pc?: KeyWords): string[] {
  const key = shortcut.key.toLowerCase();
  if (!pc) {
    return [
      ...(shortcut.ctrl ? ['⌃'] : []),
      ...(shortcut.alt ? ['⌥'] : []),
      ...(shortcut.shift ? ['⇧'] : []),
      ...(shortcut.mod ? ['⌘'] : []),
      MAC_GLYPHS[key] ?? shortcut.key.toUpperCase(),
    ];
  }
  const named = WORD_KEYS.has(key as keyof KeyWords) ? pc[key as keyof KeyWords] : undefined;
  return [
    ...(shortcut.ctrl || shortcut.mod ? [pc.ctrl] : []),
    ...(shortcut.alt ? [pc.alt] : []),
    ...(shortcut.shift ? [pc.shift] : []),
    named ?? GLYPHS[key] ?? shortcut.key.toUpperCase(),
  ];
}

/** The aria-keyshortcuts value ('Meta+Shift+Z' on a Mac, 'Control+Shift+Z' elsewhere), for assistive technology. */
export function ariaKeyShortcuts(shortcut: Shortcut, platform: HostPlatform = 'mac'): string {
  // Key names from the UI Events spec, not user-facing text.
  // eslint-disable-next-line lingui/no-unlocalized-strings
  const [control, meta, alt, shift] = ['Control', 'Meta', 'Alt', 'Shift'];
  const mac = platform === 'mac';
  return [
    ...(shortcut.ctrl || (!mac && shortcut.mod) ? [control] : []),
    ...(mac && shortcut.mod ? [meta] : []),
    ...(shortcut.alt ? [alt] : []),
    ...(shortcut.shift ? [shift] : []),
    shortcut.key.length === 1
      ? shortcut.key.toUpperCase()
      : (UI_EVENTS_KEYS[shortcut.key.toLowerCase()] ?? shortcut.key),
  ].join('+');
}

/** Named keys as the UI Events spec spells them, however the accelerator wrote them ('mod+enter' is Meta+Enter). */
/* eslint-disable lingui/no-unlocalized-strings -- key names from the UI Events spec, not user-facing text */
const UI_EVENTS_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  [
    'Enter',
    'Escape',
    'Backspace',
    'Delete',
    'Tab',
    'Space',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ].map((name) => [name.toLowerCase(), name]),
);
/* eslint-enable lingui/no-unlocalized-strings */

/** Typing in a field: the field owns the keyboard, so app shortcuts other than ⌘K stay out of its way. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/**
 * A dialog or menu is showing, so the keys are its own (focus is trapped inside it). Not one only animating out
 * (data-state="closed"), and not a native popover that is closed: that one stays in the page, hidden, until it
 * opens (the window bar's downloads popover). Overlays matching `except` don't count.
 */
export function overlayOpen(except?: string): boolean {
  return [...document.querySelectorAll(OVERLAYS)].some(
    (overlay) =>
      overlay.getAttribute('data-state') !== 'closed' &&
      !overlay.matches('[popover]:not(:popover-open)') &&
      !(except !== undefined && overlay.matches(except)),
  );
}
