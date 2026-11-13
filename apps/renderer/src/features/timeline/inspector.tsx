// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: inspector (UX4: type roles, plain words) · system: DESIGN.md v0.6 + UX4
 * the column beside the viewer says what is selected and what you can do with it: nothing (the video in one
 *   line, who chose its shots, how to start), a clip (clip-inspector.tsx), words on screen (a field, Add to chat),
 *   any other item (its own inspector, else item-inspector.tsx: EDT1), or a stretch of time (its
 *   length in beats, Add to chat); plain canvas, a hairline from the viewer, no panel chrome
 * states: each control carries the eight · empty (nothing selected: the summary) · loading: the page's bones ·
 *   error: the editor's line under the transport · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { Timeline, TimelineItemId } from '@taalcut/core';
import { Button, useShortcutFormat, useTimecode, VERB_ICONS } from '@taalcut/ui';
import { DraftConflict, useTextDraft } from './use-text-draft';
import { CaptionControls } from './caption-controls';
import { ClipInspector } from './clip-inspector';
import { GraphicInspector } from './graphic-inspector';
import { ItemInspector } from './item-inspector';
import { ACCELERATORS, KEYS } from './keys';
import { beatsBetween, type TimelineModel } from './model';
import type { EditorSelection } from './selection';
import type { ShotLookup } from './shot-frames';
import { SoundItemControls } from './sound-item-controls';
import type { Edits } from './use-edits';
import { InspectorComments } from './comments/inspector-comments';
import { AuthoredInspector } from './authored/authored-inspector';
import { useEditorTextFocus } from './use-editor-text-focus';

export type { SelectionTool } from './selection-tool';
import type { SelectionTool } from './selection-tool';

export interface InspectorProps {
  tool?: SelectionTool;
  model: TimelineModel;
  timeline: Timeline;
  selection: EditorSelection;
  onSelect: (selection: EditorSelection) => void;
  edits: Edits;
  lookup: ShotLookup;
  onAddToChat: () => void;
}

export function Inspector({
  tool = 'more',
  model,
  timeline,
  selection,
  onSelect,
  edits,
  lookup,
  onAddToChat,
}: InspectorProps) {
  const { t } = useLingui();
  const clip =
    selection?.kind === 'clip' ? model.clips.find((c) => c.item.id === selection.clipId) : undefined;
  const text =
    selection?.kind === 'text' ? model.texts.find((v) => v.item.id === selection.itemId) : undefined;
  return (
    <aside
      aria-label={t`Inspector`}
      data-slot="inspector"
      className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4"
    >
      {!selection && timeline.authoredPrograms?.length ? (
        <AuthoredInspector timeline={timeline} paused={edits.pending} />
      ) : clip ? (
        <ClipInspector
          key={clip.item.id}
          tool={tool}
          model={model}
          timeline={timeline}
          clip={clip}
          edits={edits}
          lookup={lookup}
          onAddToChat={onAddToChat}
        />
      ) : text ? (
        <TextInspector
          key={text.item.id}
          model={model}
          itemId={text.item.id}
          words={text.item.text}
          timeline={timeline}
          start={text.start}
          end={text.end}
          edits={edits}
          onAddToChat={onAddToChat}
        />
      ) : selection?.kind === 'item' && selection.itemKind === 'graphic' ? (
        // EDT1-GFX: a graphic has its own inspector (its design, Use it, timing, words, Change the look…).
        <GraphicInspector
          key={selection.itemId}
          itemId={selection.itemId as TimelineItemId}
          onSelect={onSelect}
        />
      ) : selection?.kind === 'item' ? (
        // The fallback: graphics (gfx's GraphicInspector), audio and captions (ops's) get their own before it.
        <ItemInspector
          key={selection.itemId}
          model={model}
          timeline={timeline}
          itemId={selection.itemId}
          onAddToChat={onAddToChat}
          onClear={() => onSelect(null)}
        >
          {/* EDT1-OPS: a voice line's or effect's sound, a caption's words. */}
          {selection.itemKind === 'audio' ? (
            <SoundItemControls
              timeline={timeline}
              model={model}
              item={{ kind: 'clip', clipId: selection.itemId }}
              edits={edits}
            />
          ) : selection.itemKind === 'caption' ? (
            <CaptionControls timeline={timeline} cueId={selection.itemId} edits={edits} />
          ) : undefined}
        </ItemInspector>
      ) : selection?.kind === 'range' ? (
        <RangeInspector
          model={model}
          start={selection.start}
          end={selection.end}
          onAddToChat={onAddToChat}
          onClear={() => onSelect(null)}
        />
      ) : (
        <Summary model={model} />
      )}
      {/* EDT1-CMT: Comment… on what the inspector shows, and the comments waiting on it. */}
      <InspectorComments selection={selection} timeline={timeline} />
    </aside>
  );
}

function Summary({ model }: { model: TimelineModel }) {
  const { i18n } = useLingui();
  const time = useTimecode();
  const length = time.length(model.total, model.rate);
  const clips = model.clips.length;
  const picked = model.clips.filter((clip) => clip.chosenBy === 'ai').length;
  const yours = model.clips.filter((clip) => clip.chosenBy === 'you').length;
  const bpm = model.bpm ? i18n.number(Math.round(model.bpm)) : null;
  return (
    <div data-slot="inspector-summary" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 type-card-title text-ink">
          <Trans>This video</Trans>
        </h2>
        <p className="m-0 type-meta text-ink-2 tabular-nums">
          {length} · <Plural value={clips} one="# clip" other="# clips" />
          {bpm ? (
            <>
              {' '}
              · <Trans>{bpm} beats a minute</Trans>
            </>
          ) : null}
        </p>
      </div>
      {picked + yours > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 type-body text-ink-2">
          {picked > 0 ? (
            <li className="flex items-center gap-2">
              <span aria-hidden className="h-0.5 w-4 rounded-pill bg-ai-strong" />
              <Plural value={picked} one="Taalcut picked # shot" other="Taalcut picked # shots" />
            </li>
          ) : null}
          {yours > 0 ? (
            <li className="flex items-center gap-2">
              <span aria-hidden className="h-0.5 w-4 rounded-pill bg-you-strong" />
              <Plural value={yours} one="You changed # shot" other="You changed # shots" />
            </li>
          ) : null}
        </ul>
      ) : null}
      <p className="m-0 type-body text-ink-2">
        <Trans>
          Select a clip to swap its shot or trim it on the beat. Drag across the ruler to point the chat at a
          stretch of time.
        </Trans>
      </p>
    </div>
  );
}

interface TextInspectorProps {
  timeline: Timeline;
  model: TimelineModel;
  itemId: TimelineItemId;
  words: string;
  start: number;
  end: number;
  edits: Edits;
  onAddToChat: () => void;
}

function TextInspector({
  timeline,
  model,
  itemId,
  words,
  start,
  end,
  edits,
  onAddToChat,
}: TextInspectorProps) {
  const { t } = useLingui();
  const time = useTimecode();
  const shortcut = useShortcutFormat();
  const addKeys = shortcut.text(ACCELERATORS.addToChat);
  const draft = useTextDraft({ timeline, itemId, kind: 'text' }, edits.pending);
  const field = useEditorTextFocus(itemId);
  const { value, saving } = draft;
  const setValue = draft.set;
  const changed = draft.dirty && value.trim().length > 0;
  const save = () => draft.save();
  return (
    <div ref={field} data-slot="text-inspector" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 type-card-title text-ink">{t`Text on screen`}</h2>
        <p className="m-0 type-meta text-ink-2 tabular-nums">
          {time.clock(start, model.rate)} · {time.length(end - start, model.rate)}
        </p>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="type-label text-ink-2">{t`Words`}</span>
        <textarea
          value={value}
          readOnly={edits.pending}
          rows={3}
          maxLength={500}
          data-slot="text-field"
          className="resize-none rounded-md border border-rule-strong bg-raised px-2.5 py-2 text-sm text-ink transition-colors duration-(--dur-micro) ease-(--ease-out) hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:text-ink-disabled"
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void save();
            } else if (event.key === 'Escape' && value !== words) {
              event.stopPropagation();
              setValue(words);
            }
          }}
        />
      </label>
      <DraftConflict draft={draft} paused={edits.pending} />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!changed || edits.pending || draft.conflict}
          loading={saving}
          onClick={() => void save()}
        >
          {t`Save words`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-keyshortcuts={shortcut.aria(ACCELERATORS.addToChat)}
          title={t`Add to chat (${addKeys})`}
          icon={VERB_ICONS.addToChat}
          onClick={onAddToChat}
        >
          {t`Add to chat`}
        </Button>
      </div>
      <span className="type-meta text-ink-2">{t`Return saves; Shift-Return starts a new line.`}</span>
    </div>
  );
}

interface RangeInspectorProps {
  model: TimelineModel;
  start: number;
  end: number;
  onAddToChat: () => void;
  onClear: () => void;
}

function RangeInspector({ model, start, end, onAddToChat, onClear }: RangeInspectorProps) {
  const { t } = useLingui();
  const time = useTimecode();
  const shortcut = useShortcutFormat();
  const addKeys = shortcut.text(ACCELERATORS.addToChat);
  const from = time.clock(start, model.rate);
  const to = time.clock(end, model.rate);
  return (
    <div data-slot="range-inspector" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 type-card-title text-ink tabular-nums">{t`From ${from} to ${to}`}</h2>
        <p className="m-0 type-meta text-ink-2 tabular-nums">
          {time.length(end - start, model.rate)} ·{' '}
          <Plural value={beatsBetween(model, start, end)} one="# beat" other="# beats" />
        </p>
      </div>
      <p className="m-0 type-body text-ink-2">
        {t`Ask the chat about this stretch: “make this part faster”, “put the market shots here”.`}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          aria-keyshortcuts={shortcut.aria(ACCELERATORS.addToChat)}
          title={t`Add to chat (${addKeys})`}
          icon={VERB_ICONS.addToChat}
          onClick={onAddToChat}
        >
          {t`Add to chat`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-keyshortcuts={KEYS.clear}
          icon={VERB_ICONS.close}
          onClick={onClear}
        >
          {t`Clear`}
        </Button>
      </div>
    </div>
  );
}
