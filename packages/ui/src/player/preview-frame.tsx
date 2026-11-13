// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: preview-frame · genre: atmospheric studio app (the viewer) · system: DESIGN.md v0.3
 * states: empty · loading (a viewer-grey bone; "Loading preview" for screen readers) · ready (silent) ·
 * updating (the last frame holds while an edit loads) · error (one line and its one fix). The frame is a
 * picture, not a control; its one control, Load again, is the kit's Button with the eight states.
 * contrast: pass (40–41); every word sits on the canvas under the frame, and the viewer grey, the same
 * in both themes, carries no text. motion: the bone fades out (--dur-micro, --ease-in), nothing else moves
 * pre-emit critique: P4 H4 E4 S5 R5 V4 */

import { useLingui } from '@lingui/react/macro';
import { CircleAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { DUR, EASE_IN } from '#lib/motion';

export type PreviewPhase = 'empty' | 'loading' | 'ready' | 'error';

export interface PreviewFrameProps {
  phase: PreviewPhase;
  /** A newer version is loading behind the frame on show. */
  updating?: boolean;
  /** The composition's size in pixels: the frame has its shape before anything loads. */
  width: number;
  height: number;
  /** Names the frame for screen readers. */
  label: string;
  /** A finished render rather than a live preview (the error says "video"). */
  video?: boolean;
  /** PreviewPlayer puts the player here. */
  stageRef?: Ref<HTMLDivElement>;
  /** Drawn over the frame: the safe-zone layer, the host's transport. */
  overlay?: ReactNode;
  /** Under the empty frame: what will play here and how it gets here. */
  empty?: ReactNode;
  /** The error's own sentence (its cause), instead of "The preview didn't load." */
  errorText?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * The viewer (DESIGN.md, "Footage first"): a frame on the neutral viewer grey
 * in the composition's shape, whatever is or isn't in it yet.
 */
export function PreviewFrame({
  phase,
  updating = false,
  width,
  height,
  label,
  video = false,
  stageRef,
  overlay,
  empty,
  errorText,
  onRetry,
  className,
}: PreviewFrameProps) {
  const { t } = useLingui();
  return (
    <div
      data-slot="preview-player"
      data-state={phase}
      data-updating={updating || undefined}
      className={cn('flex min-w-0 flex-col gap-3', className)}
    >
      <div
        role="group"
        aria-label={label}
        aria-busy={phase === 'loading' || updating || undefined}
        className="tc-viewer relative w-full overflow-hidden rounded-xl"
        style={{ aspectRatio: `${width} / ${height}` } as CSSProperties}
      >
        <div ref={stageRef} data-slot="preview-stage" className="absolute inset-0" />
        <AnimatePresence initial={false}>
          {phase === 'loading' ? (
            <motion.div
              key="bone"
              aria-hidden
              className="absolute inset-0"
              exit={{ opacity: 0 }}
              transition={{ duration: DUR.micro, ease: EASE_IN }}
            >
              {/* The pulse lives on the inner block: a CSS animation would override motion's fade. */}
              <span data-slot="preview-bone" className="tc-bone block size-full bg-viewer-rule" />
            </motion.div>
          ) : null}
        </AnimatePresence>
        {overlay ? <div className="absolute inset-0">{overlay}</div> : null}
      </div>
      <span role="status" className="sr-only">
        {phase === 'loading' ? t`Loading preview` : ''}
      </span>
      {phase === 'error' ? (
        <div role="alert" data-slot="preview-error" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="m-0 flex min-w-0 items-start gap-2 text-sm text-danger-strong">
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">
              {errorText ?? (video ? t`This video didn’t load.` : t`The preview didn’t load.`)}
            </span>
          </p>
          {onRetry ? (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {t`Load again`}
            </Button>
          ) : null}
        </div>
      ) : null}
      {phase === 'empty' ? (
        <div data-slot="preview-empty" className="text-sm text-ink-2">
          {empty ?? t`Nothing to preview yet.`}
        </div>
      ) : null}
    </div>
  );
}
