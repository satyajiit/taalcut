// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: a caption's controls (EDT1-OPS) · system: DESIGN.md v0.6
 * the inspector for one caption (a captions lane cue): its words in a field (Return or leaving it saves them as one
 *   undoable edit, Escape puts them back; empty takes the caption out) and whether captions show at all
 * states: the kit's field and Switch (default, hover, focus-visible, disabled) · loading (the switch's own busy) ·
 *   error (the editor's line under the transport) · empty (the caption went: one plain line) */
import { useLingui } from '@lingui/react/macro';
import type { Timeline } from '@taalcut/core';
import { Switch } from '@taalcut/ui';
import { useId, useState } from 'react';
import { DraftConflict, useTextDraft } from './use-text-draft';
import type { Edits } from './use-edits';
import { useEditorTextFocus } from './use-editor-text-focus';

export interface CaptionControlsProps {
  timeline: Timeline;
  cueId: string;
  edits: Edits;
}

export function CaptionControls({ timeline, cueId, edits }: CaptionControlsProps) {
  const { t } = useLingui();
  const field = useId();
  const words = useEditorTextFocus(cueId);
  const [busy, setBusy] = useState(false);
  const cue = timeline.captions?.cues.find((entry) => entry.id === cueId);
  const draft = useTextDraft({ timeline, itemId: cueId, kind: 'caption' }, edits.pending);
  if (!timeline.captions || !cue)
    return <p className="m-0 type-body text-ink-2">{t`This caption isn’t in the video any more.`}</p>;
  const captions = timeline.captions;

  const save = () => {
    if (!draft.conflict) void draft.save();
  };

  return (
    <section className="flex flex-col gap-3" data-slot="caption-controls">
      <div ref={words} className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={field} className="type-label text-ink">
          {t`Caption`}
        </label>
        <input
          id={field}
          value={draft.value}
          readOnly={edits.pending}
          maxLength={500}
          data-slot="caption-words"
          className="h-9 rounded-md border border-rule-strong bg-raised px-2.5 text-sm text-ink shadow-xs hover:border-ink-3 focus-visible:border-ink-2"
          onChange={(event) => draft.set(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') draft.discard();
          }}
        />
        <p className="m-0 type-caption text-ink-3">{t`Leave it empty to take this caption out.`}</p>
      </div>
      <DraftConflict draft={draft} paused={edits.pending} />
      <Switch
        disabled={edits.pending}
        checked={captions.enabled}
        loading={busy}
        label={t`Show captions`}
        onCheckedChange={async (enabled) => {
          setBusy(true);
          try {
            await edits.command('captions.setEnabled', { enabled });
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}
