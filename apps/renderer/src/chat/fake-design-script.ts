// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- scripted model output: data, never translated */

/**
 * HFW1-UI: the fake agent's Designer, as the real one acts on the bus: "a newspaper-style headline at 0:04" writes
 * the headline's files (workspace.writeFiles) and places it as a proposal at that time
 * (graphics.placeComposition), then sends its card; "make the chat bubbles look like the reel's" writes the
 * bubble's new style sheet and gives every bubble the new version (graphics.setComposition). Each step is the
 * agent's, in the run's turn group, so one ⌘Z or the changes card's Undo all takes the turn back. Its designs are
 * the ui kit's made-up fixtures (fixtures-designs.ts): nothing is designed here. A docked run ends with the
 * changes card. The fake chat reads the fake's timelines, workspace and bus through `window.taalcutFake`.
 */
import {
  agentTurnGroup,
  GRAPHICS_COMMANDS,
  RationalTime,
  WORKSPACE_COMMANDS,
  type Card,
  type EditorContext,
  type GraphicComposition,
  type SelectionChip,
  type Timeline,
} from '@taalcut/core';
import { DESIGN_COMPOSITIONS } from '@taalcut/ui';
import { asksForTrim, changesCard, trimScript } from './fake-edit-script';
import { chunks, event, type Beat, type ScriptIds } from './fake-script';

const ASKS = /\b(headline|redesign|design|bubbles?)\b/i;
const BUBBLES = /\bbubbles?\b/i;
const AT = /\b(?:at\s+)?(\d{1,2}):(\d{2})\b/;

/** True when the message asks for a graphic designed, or a new design for the bubbles. */
export function asksForDesign(text: string): boolean {
  return ASKS.test(text);
}

/**
 * The fake agent's edits: a trim ("make this shot shorter"), or from the docked chat a design request; null for a
 * message that asks for neither (a flow or the P1 scripts answer it).
 */
export function editScript(
  ids: ScriptIds,
  text: string,
  selections: readonly SelectionChip[],
  editor: EditorContext | undefined,
): Beat[] | null {
  if (asksForTrim(text)) return trimScript(ids, text, selections, editor);
  return editor && asksForDesign(text) ? designScript(ids, text, editor) : null;
}

function say(ids: ScriptIds, text: string): Beat[] {
  return chunks(text).map((delta) => ({
    wait: 40,
    event: event('agent.messageDelta', { runId: ids.runId, messageId: ids.messageId, delta }),
  }));
}

/** A tool's start and finish around the command it dispatches. */
function tool(ids: ScriptIds, name: string, act: () => void, wait = 200): Beat[] {
  const toolRunId = ids.toolRunId();
  let startedAt = 0;
  return [
    {
      wait: 80,
      event: (at) => {
        startedAt = at;
        act();
        return event('agent.toolStarted', { runId: ids.runId, toolRunId, tool: name, sideEffect: 'write' })(
          at,
        );
      },
    },
    {
      wait,
      event: (at) =>
        event('agent.toolFinished', {
          runId: ids.runId,
          toolRunId,
          tool: name,
          status: 'succeeded',
          durationMs: Math.max(0, at - startedAt),
        })(at),
    },
  ];
}

const seconds = (text: string): number | null => {
  const match = AT.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

export function designScript(ids: ScriptIds, text: string, editor?: EditorContext): Beat[] {
  const { runId, conversationId } = ids;
  const start: Beat = { wait: 0, event: event('agent.runStarted', { runId, conversationId }) };
  const end: Beat = { wait: 100, event: event('agent.runFinished', { runId, status: 'succeeded' }) };
  const fake = window.taalcutFake;
  const timeline = editor ? fake?.make.timelines.get(editor.timelineId) : undefined;
  if (!fake || !timeline || !editor)
    return [
      start,
      ...say(ids, 'Open the video in the editor and ask me there, so I know where it goes.'),
      end,
    ];
  const as = { source: 'agent' as const, actor: `agent:${runId}` };
  const group = { group: agentTurnGroup(runId) };
  const target = { projectId: timeline.projectId, timelineId: timeline.id };
  const writeFiles = (composition: GraphicComposition) => {
    const head = fake.phase3.workspace.head(timeline.projectId);
    void fake.bus.dispatch(
      WORKSPACE_COMMANDS.writeFiles,
      {
        projectId: timeline.projectId,
        baseRevision: head.revision,
        files: composition.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
      },
      as,
      group,
    );
  };
  /** The graphic's card when there is one, then the changes card, then the words. */
  const finish = (cardOf: ((now: Timeline) => Card | null) | null, words: string): Beat[] => {
    const now = () => fake.make.timelines.get(timeline.id) ?? timeline;
    const quiet = event('agent.messageDelta', { runId, messageId: ids.messageId, delta: '' });
    return [
      ...(cardOf
        ? [
            {
              wait: 20,
              event: (at: number) => {
                const card = cardOf(now());
                return card ? event('agent.card', { runId, card })(at) : quiet(at);
              },
            },
          ]
        : []),
      {
        wait: 20,
        event: (at: number) => {
          const changes = changesCard(runId, timeline, now());
          return changes ? event('agent.card', { runId, card: changes })(at) : quiet(at);
        },
      },
      ...say(ids, words),
      end,
    ];
  };

  if (BUBBLES.test(text)) {
    const bubbles = timeline.tracks.flatMap((track) =>
      track.kind === 'text'
        ? track.items.filter(
            (item) => item.type === 'graphic' && item.composition.id === DESIGN_COMPOSITIONS.bubble.id,
          )
        : [],
    );
    if (bubbles.length === 0)
      return [start, ...say(ids, 'There are no chat bubbles on this video yet.'), end];
    const next = DESIGN_COMPOSITIONS.bubbleV2;
    return [
      start,
      ...tool(ids, 'workspace.write', () => writeFiles(next)),
      ...tool(
        ids,
        'workspace.replace',
        () =>
          void fake.bus.dispatch(
            GRAPHICS_COMMANDS.setComposition,
            { ...target, itemIds: bubbles.map((item) => item.id), composition: next },
            as,
            group,
          ),
      ),
      ...finish(
        null,
        'Done: the bubbles have a tail and a soft shadow, like the reel’s. ⌘Z puts the old design back.',
      ),
    ];
  }

  const composition = DESIGN_COMPOSITIONS.headline;
  const rate = timeline.canvas.rate;
  const at = seconds(text) ?? RationalTime.toSeconds(editor.playhead);
  const before = new Set(timeline.tracks.flatMap((track) => track.items.map((item) => item.id)));
  return [
    start,
    ...tool(ids, 'workspace.write', () => writeFiles(composition)),
    ...tool(
      ids,
      'workspace.place',
      () =>
        void fake.bus.dispatch(
          GRAPHICS_COMMANDS.placeComposition,
          {
            ...target,
            composition,
            params: {},
            anchor: { kind: 'time', at: RationalTime.of(Math.round((at * rate.num) / rate.den), rate) },
            placement: 'top',
            proposal: { request: text.slice(0, 500), design: 'designed', createdAt: Date.now() },
          },
          as,
          group,
        ),
    ),
    ...finish((now) => {
      // The graphic the place step added: the one that wasn't on the timeline before the run.
      const item = now.tracks
        .flatMap((track) => (track.kind === 'text' ? track.items : []))
        .find((each) => each.type === 'graphic' && !before.has(each.id));
      if (!item) return null;
      return {
        type: 'motionGraphic',
        id: `graphic:${item.id}`,
        version: 1,
        runId,
        projectId: now.projectId,
        timelineId: now.id,
        itemId: item.id,
        composition: { id: composition.id, name: composition.name },
        start: item.start,
        duration: item.duration,
        unmatched: [],
      };
    }, 'I designed a newspaper-style headline. It plays in the viewer; Use it to keep it, or Try again for another.'),
  ];
}
