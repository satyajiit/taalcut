// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · pre-emit critique: P5 H4 E5 S5 R4 V4
 * Hallmark · component: opening choices · genre: atmospheric studio app (brand moment: the chat start)
 * system: DESIGN.md v0.4 (UX1: the chat start is a brand moment; its ways in are choice tiles, decision cards stay
 *   the only cards)
 * the ways in as choice tiles, 2 × 2 (a container query: one column under 32rem; an odd count's first tile takes the
 *   whole row, as first run's starter way does), each a hairline tile with its drawn motif (opening-tile.tsx). A way
 *   that needs more opens its panel (the reel field, the template list, add a folder, the description at first run)
 *   in a full-width row of its own right after its tile, so focus goes tile → panel and the dense grid leaves no
 *   hole; the way's error line sits in that row too
 * states (tiles): default · hover · focus-visible · active · disabled (a run is going, or the way is off: the reason
 *   replaces the line) · hollow (Use my library with nothing in it: empty frames, and the line says it opens add a
 *   folder or the phone) · loading (the tile spins while the flow starts; the others wait) · error (the cause in the
 *   tile's row, the tile keeps a danger hairline) · open (the way's accent border) · success (the chosen way stays
 *   marked, the rest fold to one line of "Or …", opening-folded.tsx)
 * motion, three primitives: the new-chat start's one entrance (`enter`: the tiles join the intro's cascade,
 *   opening-entrance.tsx), the motif's one bar on hover, focus and open, and Arrival (8 px rise and fade, 220 ms) for
 *   a panel. Reduced motion: a 150 ms fade, still motifs */

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { ChatStart, OpeningPath, TaalcutError } from '@taalcut/core';
import { motion, useReducedMotion } from 'motion/react';
import { Fragment, useId, useState, type ReactNode } from 'react';
import { Arrival } from '../chat/arrival';
import { cn } from '#lib/cn';
import { useCardActions } from './card-actions';
import { ErrorLine } from './error-line';
import { OPENING_MESSAGES, openingReason, openingWords, PARTIAL_REASONS } from './flow-labels';
import { entranceVariants } from './opening-entrance';
import { OpeningFolded } from './opening-folded';
import { OpeningPanel, useOpenPanel } from './opening-panel';
import { OpeningTile } from './opening-tile';

// The recipe chips under the new-chat start's tiles join the same entrance (index.ts takes it from here).
export { OpeningEntrance, type OpeningEntranceProps } from './opening-entrance';

/** Use my library with nothing in it says what choosing it does: it opens add a folder or the phone (UX1). */
const EMPTY_LIBRARY = msg`Nothing in it yet. Add a folder or connect your phone first.`;

export interface OpeningChoicesProps {
  paths: readonly OpeningPath[];
  unavailable: readonly { readonly path: OpeningPath; readonly reasonKey: string }[];
  hasSources: boolean;
  /** The way already taken: it stays marked, the others fold to one line. */
  chosen?: OpeningPath | undefined;
  /** A run is going: the ways wait. */
  busy?: boolean;
  /** The heading over the tiles; the chat start has its own above. */
  title?: ReactNode;
  className?: string;
  /** First run (P3-B3): the template way is "Start from a starter template" and opens the starter grid. */
  starters?: boolean;
  /** The panel open at first (a resume). */
  initialOpen?: OpeningPath | null;
  /** A panel opened or closed: first run keeps it for a resume. */
  onOpenChange?: (path: OpeningPath | null) => void;
  /** The new-chat start: the tiles join the intro's entrance. Off everywhere else (the in-chat card, first run). */
  enter?: boolean;
}

/**
 * How a video starts (P2-M13): use my library, paste a reel, start from a
 * template, or just describe it. A choice sends the chat its sentence with
 * `start`; the ones that need a link, a file, a template or a folder open it
 * in a row under the tile first.
 */
export function OpeningChoices({
  paths,
  unavailable,
  hasSources,
  chosen,
  busy = false,
  title,
  className,
  starters = false,
  initialOpen = null,
  onOpenChange,
  enter = false,
}: OpeningChoicesProps) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const reduce = useReducedMotion() ?? false;
  const [open, setOpen] = useOpenPanel(initialOpen, onOpenChange);
  const [starting, setStarting] = useState<OpeningPath | null>(null);
  const [taken, setTaken] = useState<OpeningPath | undefined>(chosen);
  const [failed, setFailed] = useState<{ path: OpeningPath; error: TaalcutError } | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  const ids = useId();
  const marked = chosen ?? taken;
  const reasonFor = (path: OpeningPath) => unavailable.find((each) => each.path === path)?.reasonKey;

  /** Starts a flow; the error comes back to the panel that asked, or under the tile. */
  const begin = async (path: OpeningPath, start: ChatStart, text: string): Promise<TaalcutError | null> => {
    if (!actions.startFlow) return null;
    setStarting(path);
    setFailed(null);
    const result = await actions.startFlow(start, text);
    setStarting(null);
    if (!result.ok) return result.error;
    setTaken(path);
    setOpen(null);
    setUnfolded(false);
    return null;
  };

  const choose = async (path: OpeningPath) => {
    // In a chat the description is typed in the composer; with none (first run) it opens under the tile.
    if (path === 'describe' && actions.focusComposer) {
      actions.focusComposer();
      return;
    }
    if (path === 'library' && hasSources) {
      const error = await begin('library', { path: 'library' }, i18n._(OPENING_MESSAGES.library));
      if (error) setFailed({ path, error });
      return;
    }
    setOpen((current) => (current === path ? null : path));
  };

  const words = (path: OpeningPath) => openingWords(i18n, path, starters);

  if (marked !== undefined && !unfolded)
    return (
      <OpeningFolded
        marked={marked}
        paths={paths}
        busy={busy}
        nameOf={(path) => words(path).name}
        onOther={(path) => {
          setUnfolded(true);
          void choose(path);
        }}
        className={className}
      />
    );

  const entrance = entranceVariants(reduce);
  return (
    <article
      data-slot="opening-choices"
      aria-label={title ? undefined : t`Ways to start`}
      className={cn('@container flex flex-col gap-3', className)}
    >
      {title}
      <ul
        aria-label={t`Ways to start`}
        className="m-0 grid list-none grid-flow-row-dense grid-cols-1 gap-3 p-0 @lg:grid-cols-2"
      >
        {paths.map((path, index) => {
          const reason = reasonFor(path);
          const off = reason !== undefined && !PARTIAL_REASONS.has(reason);
          const expandable =
            path === 'reference' ||
            path === 'template' ||
            (path === 'library' && !hasSources) ||
            (path === 'describe' && !actions.focusComposer);
          const isOpen = open === path;
          const error = failed?.path === path ? failed.error : null;
          const { name, line } = words(path);
          // Nothing in the library: still offered, and it says so; choosing it opens add a folder or the phone.
          const hollow = path === 'library' && !hasSources;
          const said = off && reason ? openingReason(i18n, reason) : hollow ? i18n._(EMPTY_LIBRARY) : line;
          // An odd count (first run's three) leads with a tile as wide as the row: no hole at the end.
          const wide = paths.length % 2 === 1 && index === 0;
          const panelId = `${ids}-${path}-panel`;
          const errorId = `${ids}-${path}-error`;
          return (
            <Fragment key={path}>
              <motion.li
                data-path={path}
                data-wide={wide || undefined}
                className={cn('flex min-w-0', wide && '@lg:col-span-2')}
                variants={entrance}
                custom={index}
                initial={enter ? 'hidden' : false}
                animate="shown"
              >
                <OpeningTile
                  path={path}
                  name={name}
                  line={said}
                  hollow={hollow}
                  expandable={expandable}
                  open={isOpen}
                  starting={starting === path}
                  disabled={busy || off || (starting !== null && starting !== path)}
                  panelId={panelId}
                  errorId={error ? errorId : undefined}
                  onChoose={() => void choose(path)}
                />
              </motion.li>
              {isOpen || error ? (
                <li data-panel-for={path} className="col-span-full min-w-0">
                  {isOpen ? (
                    <Arrival animate>
                      <div id={panelId}>
                        <OpeningPanel
                          path={path}
                          busy={busy}
                          reason={reason}
                          starters={starters}
                          begin={begin}
                          onNone={() => setOpen('reference')}
                        />
                      </div>
                    </Arrival>
                  ) : null}
                  {error ? (
                    <div id={errorId}>
                      <ErrorLine error={error} className="px-4" />
                    </div>
                  ) : null}
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ul>
    </article>
  );
}
