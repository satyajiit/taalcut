// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A short crossfade between a flow's steps (UX4, the export dialog): the new step fades in over --dur-short on
 * --ease-out while the old one fades out over --dur-micro on --ease-in, the two stacked in one grid cell so nothing
 * jumps under them. The step on its way out is inert and hidden from assistive tech at once, so focus and a screen
 * reader only ever meet the new one. Opacity only; under reduced motion both are a 150 ms fade.
 *
 * Each visit to a step is a layer of its own (the step's id and the visit's number), so going back to a step whose
 * layer is still fading out mounts it afresh rather than reviving the one on its way out: the step's heading takes
 * focus on every visit.
 */
import { AnimatePresence, DUR, EASE_IN, EASE_OUT, motion, REDUCED_FADE, useReducedMotion } from '@taalcut/ui';
import { createContext, useContext, useState, type ReactNode } from 'react';

const Current = createContext<string>('');

function Layer({ visit, children }: { visit: string; children: ReactNode }) {
  const reduced = useReducedMotion() === true;
  const leaving = useContext(Current) !== visit;
  return (
    <motion.div
      data-slot="step-layer"
      data-leaving={leaving || undefined}
      inert={leaving}
      aria-hidden={leaving || undefined}
      className="min-w-0 [grid-area:1/1]"
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        transition: reduced ? { duration: REDUCED_FADE } : { duration: DUR.short, ease: EASE_OUT },
      }}
      exit={{
        opacity: 0,
        transition: reduced ? { duration: REDUCED_FADE } : { duration: DUR.micro, ease: EASE_IN },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StepCrossfade({ id, children }: { id: string; children: ReactNode }) {
  // A new visit each time the step changes (state from the last render, not a ref read while rendering).
  const [shown, setShown] = useState({ id, visit: 0 });
  if (shown.id !== id) setShown({ id, visit: shown.visit + 1 });
  const visit = `${id}:${shown.id === id ? shown.visit : shown.visit + 1}`;
  return (
    <Current.Provider value={visit}>
      <div className="grid">
        <AnimatePresence initial={false}>
          <Layer key={visit} visit={visit}>
            {children}
          </Layer>
        </AnimatePresence>
      </div>
    </Current.Provider>
  );
}
