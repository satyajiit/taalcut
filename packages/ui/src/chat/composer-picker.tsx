// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: the composer's pickers (UX4, B14: Effects and Recipes) · Operate · system: DESIGN.md v0.7
 *   (overlay surface, the icon registry, PRESS_ROW, the motion grammar)
 * A sheet that opens above the composer, the composer's own width, and never over it or the window bar: a heading
 *   and one line of what a pick does, then the groups, each a heading over a grid of tiles. A tile is a picture (an
 *   effect drawn, a recipe's task glyph), its name and one line, in the person's language. Effects take several
 *   (a tile toggles, ticked when on, and the sheet stays); a recipe is one pick (the sheet closes and the words go in
 *   the box). The body scrolls inside the sheet when the window is short.
 * semantics: a menu (the picker is a list of things to do or turn on), each tile a menuitem (recipes) or a
 *   menuitemcheckbox (effects), named by its words and described by its line; groups are labelled groups.
 * states (tile): default · hover (hover surface) · focus-visible (the base ring, instant) · active (pressed, gives
 *   by 1 %) · on (the selected wash and an ink disc with a tick drawn in) · disabled n/a · loading, error: none
 *   (nothing is sent from here) · success: the pick is in the box or the tray
 * keyboard: one tab stop; arrows move by tile and by row, Home and End, a letter jumps to the next name that starts
 *   with it; Return or Space picks; Escape closes onto the button
 * motion: the sheet pops from the composer's edge (the kit's Popover); a tile presses; the tick draws in; an effect's
 *   picture previews on hover or focus. Reduced motion: fades, a still picture */
import { useLingui } from '@lingui/react/macro';
import { ChevronDown, X } from 'lucide-react';
import { forwardRef, useId, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '#components/button';
import { Tick } from '#components/tick';
import { cn } from '#lib/cn';
import { PRESS_ROW } from '#lib/motion-classes';

/** The tool row's quiet buttons (the model and thinking buttons' look, in the kit's tokens). */
const BUTTON = cn(
  'inline-flex h-7 flex-none cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg border-0',
  'bg-transparent px-2 whitespace-nowrap text-ink-2 select-none [font:inherit]',
  'transition-[background-color,color,scale] duration-(--dur-micro) ease-(--ease-out)',
  '[@media(hover:hover)_and_(pointer:fine)]:enabled:hover:bg-hover',
  '[@media(hover:hover)_and_(pointer:fine)]:enabled:hover:text-ink',
  'aria-expanded:bg-hover aria-expanded:text-ink',
  'active:scale-[0.98] motion-reduce:active:scale-100 disabled:cursor-default disabled:text-ink-disabled',
);

export interface PickerButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  readonly icon: ReactNode;
  readonly label: string;
  readonly open: boolean;
  /** The sheet's id, for aria-controls. */
  readonly sheetId: string;
  /** After the words: a count of what is picked. */
  readonly badge?: ReactNode;
}

/** A tool-row button that opens its sheet above the composer. ↓ opens it too, as a menu button does. */
export const PickerButton = forwardRef<HTMLButtonElement, PickerButtonProps>(function PickerButton(
  { icon, label, open, sheetId, badge, className, onKeyDown, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? sheetId : undefined}
      className={cn(BUTTON, className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && !open && event.key === 'ArrowDown') {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      {...props}
    >
      <span aria-hidden className="inline-flex [&_svg]:size-3.5">
        {icon}
      </span>
      {label}
      {badge}
      <ChevronDown aria-hidden size={12} strokeWidth={2.4} />
    </button>
  );
});

export interface PickerTile {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /** The tile's picture: an effect drawn, or a task's glyph in its square. Decorative. */
  readonly picture: ReactNode;
  readonly selected?: boolean;
}

export interface PickerGroup {
  readonly id: string;
  readonly label: string;
  readonly tiles: readonly PickerTile[];
}

export interface PickerSheetProps {
  readonly title: string;
  /** One line under the title: what a pick does. */
  readonly hint: string;
  readonly groups: readonly PickerGroup[];
  /** `many`: tiles toggle and the sheet stays (effects). `one`: a pick closes it (recipes). */
  readonly mode: 'many' | 'one';
  readonly onPick: (id: string) => void;
  readonly onClose: () => void;
  /** At the heading's end, before Close: Clear, for effects. */
  readonly actions?: ReactNode;
  /** The data attribute each tile carries its id in (`data-effect`, `data-recipe`), for the app's tests. */
  readonly tileAttribute: 'data-effect' | 'data-recipe';
  readonly slot: string;
}

const TILES = '[data-picker-tile]';

/**
 * Moves focus between the sheet's tiles: arrows by tile and by row (in a single column, or before layout, the next and
 * the one before), Home, End and a first letter. Return picks, as in any menu.
 */
function onTilesKey(event: KeyboardEvent<HTMLDivElement>) {
  const tiles = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(TILES)];
  const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0 || tiles.length === 0) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    tiles[at]!.click();
    return;
  }
  const here = tiles[at]!.getBoundingClientRect();
  const flat = tiles.every((tile) => {
    const box = tile.getBoundingClientRect();
    return box.top === here.top && box.left === here.left;
  });
  const go = (index: number) => {
    event.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, index))]?.focus();
  };
  const row = (down: boolean) => {
    if (flat) return go(at + (down ? 1 : -1));
    const rows = tiles.filter((tile) => {
      const top = tile.getBoundingClientRect().top;
      return down ? top > here.top + 2 : top < here.top - 2;
    });
    if (rows.length === 0) return event.preventDefault();
    const edge = down
      ? Math.min(...rows.map((tile) => tile.getBoundingClientRect().top))
      : Math.max(...rows.map((tile) => tile.getBoundingClientRect().top));
    const next = rows
      .filter((tile) => Math.abs(tile.getBoundingClientRect().top - edge) < 2)
      .sort(
        (a, b) =>
          Math.abs(a.getBoundingClientRect().left - here.left) -
          Math.abs(b.getBoundingClientRect().left - here.left),
      )[0];
    if (next) go(tiles.indexOf(next));
  };
  if (event.key === 'ArrowRight') go(at + 1);
  else if (event.key === 'ArrowLeft') go(at - 1);
  else if (event.key === 'ArrowDown') row(true);
  else if (event.key === 'ArrowUp') row(false);
  else if (event.key === 'Home') go(0);
  else if (event.key === 'End') go(tiles.length - 1);
  else if (event.key.length === 1 && /\p{L}/u.test(event.key) && !event.metaKey && !event.ctrlKey) {
    const letter = event.key.toLocaleLowerCase();
    for (let step = 1; step <= tiles.length; step += 1) {
      const tile = tiles[(at + step) % tiles.length]!;
      const name = tile.querySelector('[data-tile-name]')?.textContent?.trim().toLocaleLowerCase() ?? '';
      if (name.startsWith(letter)) return go(tiles.indexOf(tile));
    }
  }
}

/** The sheet's body: the heading, then each group's tiles. Goes inside the composer's Popover. */
export function PickerSheet({
  title,
  hint,
  groups,
  mode,
  onPick,
  onClose,
  actions,
  tileAttribute,
  slot,
}: PickerSheetProps) {
  const { t } = useLingui();
  const ids = useId();
  // One tab stop: the first tile until another takes focus (onFocus below hands it on).
  const firstId = groups.find((group) => group.tiles.length > 0)?.tiles[0]?.id;
  return (
    <div data-slot={slot} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-3 border-b border-rule-subtle px-4 pt-3 pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={`${ids}-title`} className="m-0 type-card-title text-ink">
            {title}
          </h2>
          <p className="m-0 type-meta text-ink-2">{hint}</p>
        </div>
        {actions}
        <Button variant="ghost" size="icon" aria-label={t`Close`} onClick={onClose} className="-me-2 size-8">
          <X aria-hidden />
        </Button>
      </div>
      <div
        role="menu"
        aria-labelledby={`${ids}-title`}
        className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain scrollbar-thin px-3 pt-3 pb-4"
        onKeyDown={onTilesKey}
      >
        {groups.map((group) => (
          <div
            key={group.id}
            role="group"
            aria-labelledby={`${ids}-${group.id}`}
            className="flex flex-col gap-1"
          >
            <div id={`${ids}-${group.id}`} className="px-1 type-caption text-ink-2">
              {group.label}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-1">
              {group.tiles.map((tile) => {
                const tabbable = tile.id === firstId;
                const tileId = `${ids}-${group.id}-${tile.id}`;
                return (
                  <button
                    key={tile.id}
                    type="button"
                    data-picker-tile=""
                    {...{ [tileAttribute]: tile.id }}
                    tabIndex={tabbable ? 0 : -1}
                    {...(mode === 'many'
                      ? { role: 'menuitemcheckbox', 'aria-checked': tile.selected === true }
                      : { role: 'menuitem' })}
                    aria-labelledby={`${tileId}-name`}
                    aria-describedby={tile.description ? `${tileId}-line` : undefined}
                    onFocus={(event) => {
                      // One tab stop: the tile last focused is the one Tab comes back to.
                      const sheet = event.currentTarget.closest('[role=menu]');
                      for (const other of sheet?.querySelectorAll<HTMLElement>(TILES) ?? [])
                        other.tabIndex = -1;
                      event.currentTarget.tabIndex = 0;
                    }}
                    onClick={() => onPick(tile.id)}
                    className={cn(
                      'group/tile relative flex cursor-pointer gap-3 rounded-lg p-2 text-start',
                      tile.description ? 'min-h-18 items-start' : 'items-center',
                      'hover:bg-hover active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                      PRESS_ROW,
                      tile.selected && 'bg-selected hover:bg-selected',
                    )}
                  >
                    {tile.picture}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 pe-5">
                      <span id={`${tileId}-name`} data-tile-name className="type-label text-ink">
                        {tile.label}
                      </span>
                      {tile.description ? (
                        <span id={`${tileId}-line`} className="line-clamp-2 type-meta text-ink-2">
                          {tile.description}
                        </span>
                      ) : null}
                    </span>
                    {tile.selected ? (
                      <span
                        aria-hidden
                        className="absolute end-2 top-2 grid size-4 place-items-center rounded-pill bg-inverse text-on-inverse"
                      >
                        <Tick className="size-3" strokeWidth={2.5} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
