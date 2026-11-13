// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: the editor's Pacing tab · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * under the bed: a "Pacing" tab (opens ?panel=pacing); open, the bands sit in the bed's scroll box right under
 *   the beat lane, at the bed's zoom, and the controls row sits under the bed (it doesn't scroll away)
 * states: hidden (a story-mode cast, a voice-led cut, no template: nothing to pace) · no beat map ("This video
 *   follows speech, not music beats") · closed (the tab) · open (bands and controls) · loading (the template
 *   version on its way: the tab waits) · the rest are the bands' and the controls' · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  newId,
  ok,
  TIMELINE_COMMANDS,
  type EnergyCurvePlan,
  type Template,
  type Timeline,
} from '@taalcut/core';
import { Button, cn } from '@taalcut/ui';
import { Activity, ChevronDown } from 'lucide-react';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useBackend } from '../../../backend/backend';
import { useEditorContext, type EditorContextValue } from '../editor-context';
import { useDefaultCurve } from './default-curve';
import { PacingBands } from './pacing-bands';
import { PacingControls } from './pacing-controls';
import { usePacing, type Pacing, type PacingSource } from './use-pacing';

export type PacingAvailability = 'hidden' | 'loading' | 'noBeats' | 'ready';

/** Whether this video has pacing to change: cut to a template, on music beats, not led by a voice or a story. */
export function pacingAvailability(timeline: Timeline, template: Template | null): PacingAvailability {
  if (!timeline.template || timeline.cast?.mode === 'story' || timeline.voiceover) return 'hidden';
  if (!template || template.id !== timeline.template.id || template.version !== timeline.template.version)
    return 'loading';
  return template.beatMap && template.beatMap.beats.length > 0 ? 'ready' : 'noBeats';
}

/** Whether a locked clip sits in a slot the plan changes (it stays on the first new cut). */
function lockedInChanged(timeline: Timeline, plan: EnergyCurvePlan): boolean {
  const changed = new Set<string>(plan.slotMap.flatMap((entry) => (entry.unchanged ? [] : entry.from)));
  const video = timeline.tracks[0];
  return (video?.kind === 'video' ? video.items : []).some(
    (item) => item.type === 'clip' && item.locked && item.slotId !== null && changed.has(item.slotId),
  );
}

const PacingContext = createContext<Pacing<EnergyCurvePlan> | null>(null);

function OpenPacing({
  editor,
  template,
  children,
}: {
  editor: EditorContextValue;
  template: Template;
  children: ReactNode;
}) {
  const backend = useBackend();
  const defaultCurve = useDefaultCurve(template);
  const { projectId, timeline } = editor;
  const source = useMemo<PacingSource<EnergyCurvePlan>>(
    () => ({
      template,
      defaultCurve,
      preview: async (curve, signal) => {
        const planned = await callRpc(
          backend.timelines.planEnergyCurve({ timelineId: timeline.id, curve }, { signal }),
        );
        if (!planned.ok) return planned;
        const plan = planned.value;
        return ok({
          curve,
          cuts: plan.cuts,
          changed: plan.changedSlots,
          picks: plan.picks.length,
          lockedKept: lockedInChanged(timeline, plan),
          plan,
        });
      },
      apply: (preview) =>
        callRpc(
          backend.commands.dispatch({
            name: TIMELINE_COMMANDS.applyEnergyCurve,
            payload: {
              projectId,
              timelineId: timeline.id,
              templateBaseVersion: preview.plan.templateBaseVersion,
              curve: preview.curve,
              picks: preview.plan.picks,
            },
            source: 'ui',
            idempotencyKey: newId(),
          }),
        ),
      undo: () => callRpc(backend.commands.undo({ projectId, source: 'ui' })),
    }),
    [backend, template, defaultCurve, projectId, timeline],
  );
  const pacing = usePacing(source);
  return <PacingContext.Provider value={pacing}>{children}</PacingContext.Provider>;
}

/** Wraps the bed: while the Pacing tab is open, its bands and its controls share one draft. */
export function EditorPacingProvider({ children }: { children: ReactNode }) {
  const editor = useEditorContext();
  if (!editor || editor.panel !== 'pacing' || !editor.template) return children;
  if (pacingAvailability(editor.timeline, editor.template) !== 'ready') return children;
  return (
    <OpenPacing editor={editor} template={editor.template}>
      {children}
    </OpenPacing>
  );
}

/** P3-V12: the Pacing tab's bands, in the bed's scroll box (reads the editor's context). */
export function EditorPacing({ pxPerFrame }: { readonly pxPerFrame: number }) {
  const editor = useEditorContext();
  const pacing = useContext(PacingContext);
  if (!editor?.template || !pacing) return null;
  const template = editor.template;
  // Template frames onto the timeline's frames (the same rate when made from it).
  const scale =
    (editor.timeline.canvas.rate.num * template.canvas.rate.den) /
    (editor.timeline.canvas.rate.den * template.canvas.rate.num);
  const ghost = pacing.state.status === 'ready' ? pacing.state.preview.cuts : null;
  return (
    <PacingBands
      template={template}
      curve={pacing.draft}
      selected={pacing.selected}
      onSelect={pacing.select}
      onChange={pacing.change}
      px={(frame) => frame * scale * pxPerFrame}
      ghost={ghost}
      className="mt-1 border-t border-rule-subtle"
    />
  );
}

/** The gutter's row for the bands, beside them. */
export function EditorPacingGutter({ icon }: { readonly icon: ReactNode }) {
  const pacing = useContext(PacingContext);
  return pacing ? <div className="mt-1 flex h-16 items-center">{icon}</div> : null;
}

/** Under the bed: the Pacing tab, and when it is open the controls (or why there is nothing to pace). */
export function EditorPacingBar() {
  const { t } = useLingui();
  const editor = useEditorContext();
  const pacing = useContext(PacingContext);
  if (!editor) return null;
  const availability = pacingAvailability(editor.timeline, editor.template);
  if (availability === 'hidden') return null;
  const open = editor.panel === 'pacing';
  return (
    <div
      data-slot="pacing-bar"
      className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-rule-subtle px-3 py-1.5"
    >
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        disabled={availability === 'loading'}
        className={cn(open && 'bg-selected text-ink hover:bg-selected')}
        onClick={() => editor.onPanel(open ? undefined : 'pacing')}
      >
        <Activity aria-hidden />
        {t`Pacing`}
        <ChevronDown
          aria-hidden
          className={cn('transition-transform duration-(--dur-short)', open && 'rotate-180')}
        />
      </Button>
      {open && availability === 'noBeats' ? (
        <p className="m-0 self-center text-sm text-ink-2" data-slot="pacing-no-beats">
          {t`This video follows speech, not music beats`}
        </p>
      ) : null}
      {open && pacing && editor.template ? (
        <PacingControls pacing={pacing} template={editor.template} kind="video" className="min-w-0 flex-1" />
      ) : null}
    </div>
  );
}
