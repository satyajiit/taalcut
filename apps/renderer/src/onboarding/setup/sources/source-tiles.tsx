// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: first run's ways in as tiles (UX4) · genre: atmospheric studio app · system: DESIGN.md v0.6 (UX3) +
 *   _orch/ux4/specs/design-onb.md
 * the ways side by side as choice tiles (the chat start's: a rule-subtle hairline, lg radius, no fill, shadow or
 *   stripe; one column when the step is narrow), each led by its registry glyph (20 px, ink-2), its name
 *   (type-card-title) and one line (type-body); the chosen way's panel opens under the row of tiles, full width and
 *   on the column's own left edge, so the band, the QR and its steps line up with the heading above them. A way
 *   that already works says so at its tile's foot. ChoiceTile is the one tile, here and on the last step.
 * motion: Arrival for the opened panel (8 px rise and fade, 220 ms; reduced motion: fade); a tile gives 1 % pressed.
 * states (tiles): default · hover (rule border, hover surface, eased) · focus (base ring, instant) · active (pressed
 *   surface, gives 1 %) · open (marigold border, aria-expanded) · done (the check and the words, announced by the
 *   panel) · disabled (dimmed, its reason in its line) · loading, error: n/a (each panel has its own)
 */
import { Arrival, CONCEPT_ICONS, Glyph, HOVER_EASE, PRESS_ROW, cn } from '@taalcut/ui';
import { useId, type ReactNode } from 'react';

export interface SourceTile<Id extends string> {
  readonly id: Id;
  readonly icon: ReactNode;
  /** The way's name: its tile's words and its panel's accessible name. */
  readonly title: string;
  readonly line: ReactNode;
  /** This way works already: what came in ("2 folders added"). */
  readonly done?: ReactNode;
  readonly panel: ReactNode;
}

export interface SourceTilesProps<Id extends string> {
  readonly label: string;
  readonly ways: readonly SourceTile<Id>[];
  readonly open: Id | null;
  onOpen(id: Id | null): void;
  /** Opened by a resume or a click: animate only what the person opened. */
  readonly animate?: boolean;
}

/** One way in: its glyph, name and line, and what already works at its foot. A toggle for its panel. */
export function ChoiceTile({
  icon,
  title,
  line,
  done,
  open,
  panelId,
  disabled = false,
  onToggle,
}: {
  icon: ReactNode;
  title: ReactNode;
  line: ReactNode;
  done?: ReactNode;
  open: boolean;
  /** The panel's id while it is open (aria-controls). */
  panelId?: string | undefined;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'group flex w-full origin-center cursor-pointer flex-col items-start gap-2 rounded-lg border p-4 text-start',
        PRESS_ROW,
        'hover:bg-hover active:bg-pressed disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent',
        open
          ? 'border-primary-strong shadow-[inset_0_0_0_1px_var(--color-primary-strong)]'
          : 'border-rule-subtle hover:border-rule',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-flex size-5 items-center justify-center',
          HOVER_EASE,
          open ? 'text-ink' : 'text-ink-2 group-hover:text-ink',
        )}
      >
        {icon}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="type-card-title text-ink">{title}</span>
        <span className="type-body text-ink-2">{line}</span>
      </span>
      {done ? (
        <span className="mt-auto flex items-start gap-1.5 pt-1 type-label text-ink">
          <Glyph icon={CONCEPT_ICONS.success} className="mt-0.75 text-success-strong" />
          {done}
        </span>
      ) : null}
    </button>
  );
}

/** The ways in as tiles; the open one's panel under them. */
export function SourceTiles<Id extends string>({
  label,
  ways,
  open,
  onOpen,
  animate = true,
}: SourceTilesProps<Id>) {
  const base = useId();
  const chosen = ways.find((way) => way.id === open);
  return (
    <div className="@container flex flex-col gap-8">
      <ul aria-label={label} className="m-0 grid list-none grid-cols-1 gap-3 p-0 @xl:grid-cols-3">
        {ways.map((way) => {
          const isOpen = open === way.id;
          return (
            <li key={way.id} data-way={way.id} className="flex">
              <ChoiceTile
                icon={way.icon}
                title={way.title}
                line={way.line}
                done={way.done}
                open={isOpen}
                panelId={`${base}-${way.id}`}
                onToggle={() => onOpen(isOpen ? null : way.id)}
              />
            </li>
          );
        })}
      </ul>
      {chosen ? (
        <Arrival key={chosen.id} animate={animate}>
          <div id={`${base}-${chosen.id}`} role="region" aria-label={chosen.title} data-way-panel={chosen.id}>
            {chosen.panel}
          </div>
        </Arrival>
      ) : null}
    </div>
  );
}
