// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the features index's live fragments · mode: Operate · system: WEB2 Remix Vernacular
 * each feature's showcase in small, working, in its own coded app window: the breakdown's beats, shots and cuts (hover
 *   for a time, the arrows move a cut) with the reel playing beside them; the roll with its search; one template and
 *   its clips switch; the agent's run, played on request; the editor's clips with a trim from the keyboard ([ and ],
 *   as in the app)
 * states: the showcases' own (breakdown-lanes, library-search, template-fill, agent-showcase, editor-timeline)
 * motion: the breakdown's reading playhead is the index's one arrival, then the reel's clock; reduced motion: nothing
 *   moves until the visitor plays the reel */

import { useMotionValue } from 'motion/react';
import { useMemo } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { AppWindow } from '#components/ui/app-window';
import { LibrarySearch } from './auto-pick/library-search';
import { SAMPLE_ROLL } from './auto-pick/roll';
import { BreakdownLanes } from './breakdown/breakdown-lanes';
import { useBreakdownState } from './breakdown/breakdown-showcase';
import { sampleBreakdown } from './breakdown/sample';
import { Chip } from './chip';
import { CLIPS } from './editor/cut';
import { useCutEdits } from './editor/editor-showcase';
import { EditorTimeline } from './editor/editor-timeline';
import { Key, ShowcasePlate } from './plate';
import { ReelSide } from './reel-side';
import { formatTime } from './timecode';
import { useArrival } from './use-arrival';

export function BreakdownFragment() {
  const sample = useMemo(sampleBreakdown, []);
  const state = useBreakdownState(sample);
  const time = useMotionValue(0);
  const [lanes, phase] = useArrival<HTMLDivElement>(0.5);
  const shown = state.active ?? state.selected;
  const at = shown === null ? undefined : state.times[shown];
  return (
    <div className="flex items-start gap-6">
      <div className="hidden w-40 shrink-0 md:block">
        <ReelSide time={time} />
      </div>
      <AppWindow title="Read a reel" area="templates" size="md" fit="fluid" className="min-w-0 flex-1">
        <ShowcasePlate
          slug="reel-breakdown-fragment"
          label="A saved reel’s cuts and beats"
          className="flex flex-col gap-4"
        >
          <div ref={lanes} data-arrival={phase}>
            <BreakdownLanes
              compact
              sample={sample}
              times={state.times}
              original={state.original}
              open={state.open}
              active={state.active}
              onActive={state.setActive}
              selected={state.selected}
              onSelect={state.setSelected}
              onMove={state.move}
              onReset={state.reset}
              onLooksRight={state.looksRight}
              play={phase === 'play'}
              time={time}
            />
          </div>
          <p className="m-0 type-meta text-ink-2">
            {at === undefined ? (
              'Point at a cut for its time; the arrow keys move it.'
            ) : (
              <>
                Cut {(shown ?? 0) + 1} at <span className="tc-mono">{formatTime(at)}</span>
              </>
            )}
          </p>
        </ShowcasePlate>
      </AppWindow>
    </div>
  );
}

export function AutoPickFragment() {
  return (
    <AppWindow title="Camera roll" area="library" size="md" fit="fluid">
      <ShowcasePlate slug="auto-pick-fragment" label="A camera roll, searched">
        <LibrarySearch clips={SAMPLE_ROLL} compact />
      </ShowcasePlate>
    </AppWindow>
  );
}

export { TemplatesFragment } from './templates/fragment';

export { AgentFragment } from './agent/fragment';

export function EditorFragment() {
  const edits = useCutEdits();
  const clip = CLIPS[edits.selected];
  const trimmed = edits.trimmed.has(edits.selected);
  return (
    <AppWindow title="Editor" area="make" size="md" fit="fluid">
      <ShowcasePlate slug="editor-fragment" label="A cut’s clips" className="flex flex-col gap-3">
        <EditorTimeline
          compact
          cut={edits.cut}
          trimmed={edits.trimmed}
          selected={edits.selected}
          onSelect={edits.setSelected}
          onTrim={edits.trim}
          at={3.2}
        />
        <p role="status" className="m-0 flex flex-wrap items-center gap-2 type-meta text-ink-2">
          <span className="type-body text-ink">
            Clip {edits.selected + 1}: {clip?.word}
          </span>
          <Chip tone="ai">
            <AiMark />
            AI pick
          </Chip>
          {trimmed ? <Chip>Trimmed</Chip> : null}
          <span>
            Choose a clip, then <Key>[</Key> or <Key>]</Key> trims it a beat.
          </span>
        </p>
      </ShowcasePlate>
    </AppWindow>
  );
}
