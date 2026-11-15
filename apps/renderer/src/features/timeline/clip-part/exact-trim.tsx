// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the exact trim, folded (TRIM1) · system: DESIGN.md v0.7
 * the precise fallback under "pick the part": Remove and Restore by an amount in seconds, or in frames, at the
 *   scene's beginning and end (clip-trim-controls.tsx), behind one line so the picture and the strip stay the
 *   tool's first sight. Open from the start when the scene has no part to pick (a photo, a held moment)
 * states: closed · open (the inspector's own disclosure, as "Source details") · the controls carry their own
 */
import { useLingui } from '@lingui/react/macro';
import { ClipTrimControls } from '../clip-trim-controls';
import type { ClipView, TimelineModel } from '../model';
import type { Edits } from '../use-edits';

export function ExactTrim({
  clip,
  model,
  edits,
  open,
}: {
  clip: ClipView;
  model: TimelineModel;
  edits: Edits;
  /** Open from the start. */
  open: boolean;
}) {
  const { t } = useLingui();
  return (
    <details data-slot="exact-trim" open={open || undefined} className="border-t border-rule-subtle pt-2">
      <summary className="cursor-pointer rounded-sm type-label text-ink-2">{t`Trim by an exact amount`}</summary>
      <div className="pt-3">
        <ClipTrimControls clip={clip} model={model} edits={edits} />
      </div>
    </details>
  );
}
