// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cleanup marks on the bed · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * while the Clean up panel shows a plan, the spans it would remove lie hatched over the clips (neutral ink: a mark
 *   on the data, not a meaning in colour) and the punch-ins as a bar along the clips' top, at the bed's zoom
 * states: none (no plan, or the video moved on since it: nothing drawn) · shown · not interactive (the panel
 *   says it in words for assistive tech) · pre-emit critique: P4 H5 E5 S5 R5 V4 */
import { cleanupMarks, cn } from '@taalcut/ui';
import { useEditorContext } from '../editor-context';
import { useCleanupPreview } from './cleanup-preview';

const HATCH = 'bg-[repeating-linear-gradient(135deg,var(--color-ink-2)_0_1px,transparent_1px_5px)]';

export function CleanupBedMarks({ pxPerFrame }: { readonly pxPerFrame: number }) {
  const editor = useEditorContext();
  const plan = useCleanupPreview(editor?.timeline.id ?? null);
  if (!editor || !plan || plan.revision !== editor.timeline.revision) return null;
  const marks = cleanupMarks(editor.timeline, plan);
  return (
    <div
      aria-hidden
      data-slot="cleanup-bed-marks"
      className="pointer-events-none absolute inset-x-0 top-1 h-16"
    >
      {marks.removed.map((span) => (
        <span
          key={`cut-${span.start}`}
          data-slot="cleanup-removed"
          className={cn('absolute inset-y-0 rounded-[2px] bg-scrim/40', HATCH)}
          style={{ left: span.start * pxPerFrame, width: Math.max(1, (span.end - span.start) * pxPerFrame) }}
        />
      ))}
      {marks.punches.map((span) => (
        <span
          key={`punch-${span.start}`}
          data-slot="cleanup-punch"
          className="absolute top-0 h-1 rounded-pill bg-ink"
          style={{ left: span.start * pxPerFrame, width: Math.max(2, (span.end - span.start) * pxPerFrame) }}
        />
      ))}
    </div>
  );
}
