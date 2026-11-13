// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: the captions lane (EDT1-OPS) · system: DESIGN.md v0.6
 * the captions at their times, each line's words as a quiet pill (as said, never translated), under the words on
 *   screen; off captions are drawn faint with "Captions off" at the lane's left. A small label stays at the left
 *   while you scroll. A press selects a caption: the inspector shows its words to fix, and the chat's "this" is it.
 * states: default · hover (hover surface) · focus-visible (the base ring on the active cue) · selected (marigold edge) · off (faint,
 *   "Captions off") · empty (no captions built: the lane isn't drawn) */
import { useLingui } from '@lingui/react/macro';
import { cn, UserContent } from '@taalcut/ui';
import { useEditorContext } from './editor-context';
import { toFrames } from './model';
import { ACTIVE_RING, useLaneListbox } from './use-lane-listbox';

export interface CaptionsLaneProps {
  pxPerFrame: number;
}

export function CaptionsLane({ pxPerFrame }: CaptionsLaneProps) {
  const { t } = useLingui();
  const editor = useEditorContext();
  const cues = editor?.timeline.captions?.cues ?? [];
  const selectedId = editor?.selection?.kind === 'item' ? editor.selection.itemId : null;
  const select = (itemId: (typeof cues)[number]['id']) =>
    editor?.select({ kind: 'item', timelineId: editor.timeline.id, itemId, itemKind: 'caption' });
  const edit = (itemId: (typeof cues)[number]['id']) =>
    editor?.editText({ kind: 'item', timelineId: editor.timeline.id, itemId, itemKind: 'caption' });
  const lane = useLaneListbox(
    cues.map((cue) => cue.id),
    selectedId,
    select,
  );
  const captions = editor?.timeline.captions;
  if (!editor || !captions || cues.length === 0) return null;
  const rate = editor.model.rate;
  const label = captions.enabled ? t`Captions` : t`Captions off`;
  return (
    <div data-slot="captions-lane" data-enabled={captions.enabled || undefined} className="relative h-6">
      <span
        aria-hidden
        className="pointer-events-none sticky left-1 z-10 inline-block rounded-sm bg-sunken/80 px-1 type-caption text-ink-3"
      >
        {label}
      </span>
      {/* EDT1 gate: the lane is one listbox (one tab stop, 24 px tall); a cue is often narrower than a target can
          be, so the arrow keys move along the cues and Enter selects one. A press selects it at once. */}
      <div
        {...lane.listbox}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && lane.active) {
            event.preventDefault();
            event.stopPropagation();
            edit(lane.active);
          } else lane.listbox.onKeyDown(event);
        }}
        aria-label={label}
        aria-orientation="horizontal"
        className="group pointer-events-none absolute inset-0 rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        {cues.map((cue) => {
          const start = toFrames(cue.range.start, rate);
          const frames = toFrames(cue.range.duration, rate);
          const words = cue.words.map((word) => word.text).join(' ');
          const selected = cue.id === selectedId;
          return (
            // EDT1-OPS: a press selects the caption (ctx's select); the inspector shows its words to fix.
            <div
              key={cue.id}
              id={lane.optionId(cue.id)}
              role="option"
              aria-selected={selected}
              data-active={cue.id === lane.active || undefined}
              data-slot="caption-cue"
              data-cue-id={cue.id}
              className={cn(
                'pointer-events-auto absolute top-0.5 flex h-5 cursor-pointer items-center overflow-hidden rounded-sm border border-rule-subtle bg-raised/70 px-1 text-2xs whitespace-nowrap text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover',
                ACTIVE_RING,
                !captions.enabled && 'opacity-50',
                selected && 'border-primary-strong',
              )}
              style={{ left: start * pxPerFrame, width: Math.max(12, frames * pxPerFrame - 2) }}
              onClick={() => {
                lane.setActive(cue.id);
                select(cue.id);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                edit(cue.id);
              }}
            >
              <UserContent className="truncate">{words}</UserContent>
            </div>
          );
        })}
      </div>
    </div>
  );
}
