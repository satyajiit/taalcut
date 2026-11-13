// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the viewer's ambient backdrop · genre: atmospheric studio app (the viewer)
 * system: DESIGN.md v0.5 (UX2: the clip page's viewer) · the space around a clip that doesn't fill the stage is
 *   the clip's own frame (the shot at the playhead), blurred far past recognition and dimmed under the viewer
 *   grey, so the light around the picture is the picture's and the picture stays the only sharp colour
 * states: a frame · none yet (the viewer grey alone) · a new shot (crossfade, --dur-long) · interactive n/a
 * motion: opacity only, EASE_OUT over DUR.long; reduced motion: a 150 ms fade
 */
import { AnimatePresence, DUR, EASE_OUT, motion, REDUCED_FADE, useReducedMotion } from '@taalcut/ui';

export function ClipBackdrop({ src }: { src: string | null }) {
  const reduce = useReducedMotion();
  return (
    <div
      aria-hidden
      data-slot="clip-backdrop"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <AnimatePresence initial={false}>
        {src ? (
          <motion.img
            key={src}
            src={src}
            alt=""
            draggable={false}
            decoding="async"
            className="absolute inset-0 size-full object-cover blur-3xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? REDUCED_FADE : DUR.long, ease: EASE_OUT }}
          />
        ) : null}
      </AnimatePresence>
      <div className="absolute inset-0 bg-viewer/55" />
    </div>
  );
}
