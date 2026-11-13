// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the models do in the gate demo, turn by turn: "Add my Desktop/Trip
 * folder and tell me what's in the first video", then two follow-ups that
 * upload another frame each. The scripted clients and the stand-in provider
 * the recording was made against both answer from here, and read ids and
 * paths from the tool results like a real model would.
 */
import type { ModelChoice } from '@taalcut/models';

export const GATE_DEMO_ASK = "Add my Desktop/Trip folder and tell me what's in the first video.";

/** The agent's model in the recorded session. */
export const GATE_AGENT: ModelChoice = {
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  reasoning: 'low',
};

/**
 * A cloud vision model, so describing a frame uploads it and needs the user's
 * consent. Anthropic, not Google: pi-ai's Google adapter refuses the metered
 * fetch every ModelClient call passes, so Google calls can't go through
 * @taalcut/models yet.
 */
export const CLOUD_VISION: ModelChoice = {
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
  reasoning: 'low',
};

export const FRAME_DESCRIPTION = 'A test pattern of colour bars with a running timer in the corner.';

export const GATE_DEMO_ANSWER = `The first video, beach.mov, shows: ${FRAME_DESCRIPTION}`;

/**
 * The chat's title, which the agent's model writes after the first exchange
 * (createConversationTitler in @taalcut/agent): a request without tools.
 */
export const GATE_DEMO_TITLE = 'First video in the Trip folder';

/**
 * Asks after the first, each with one more frame upload: one in the same
 * conversation, one after the app restarts ("Always allow" from the first
 * covers both, so neither asks), and one after that consent is revoked,
 * which asks again.
 */
export interface FollowUp {
  readonly ask: string;
  /** The frame, value / rate seconds. Each is a new frame, so vision's cache can't answer it. */
  readonly at: { readonly value: number; readonly rate: number };
  readonly answer: string;
}

export const GATE_DEMO_FOLLOW_UPS: readonly [FollowUp, FollowUp, FollowUp] = [
  {
    ask: "What's in beach.mov at 1.5 seconds?",
    at: { value: 1500, rate: 1000 },
    answer: `At 1.5 seconds, beach.mov shows: ${FRAME_DESCRIPTION}`,
  },
  {
    ask: 'And half a second into beach.mov?',
    at: { value: 500, rate: 1000 },
    answer: `Half a second in, beach.mov shows: ${FRAME_DESCRIPTION}`,
  },
  {
    ask: 'And just before beach.mov ends?',
    at: { value: 1900, rate: 1000 },
    answer: `Just before the end, beach.mov shows: ${FRAME_DESCRIPTION}`,
  },
];

/** Every ask in the demo, in order. Replay tells their turns apart by these (recorded-models.ts). */
export const GATE_DEMO_ASKS: readonly string[] = [GATE_DEMO_ASK, ...GATE_DEMO_FOLLOW_UPS.map((f) => f.ask)];

export interface DemoTurn {
  readonly text?: string;
  readonly reasoning?: string;
  readonly toolCall?: { readonly name: string; readonly args: Record<string, unknown> };
}

// Paths from the disk arrive in untrusted blocks; the first one in a result is the first file's or source's.
const firstPath = (result: string | undefined) =>
  /source="file-system">\n(\/[^\n]+)\n<\/untrusted>/.exec(result ?? '')?.[1] ?? '';
const use = (name: string, args: Record<string, unknown>) => ({ toolCall: { name, args } });

/**
 * The agent model's reply on `turn` (assistant messages so far) of the run
 * that `ask` started, given every tool result so far, oldest first.
 */
export function gateDemoTurn(turn: number, toolResults: readonly string[], ask = GATE_DEMO_ASK): DemoTurn {
  const followUp = GATE_DEMO_FOLLOW_UPS.find((f) => ask.includes(f.ask));
  return followUp ? followUpTurn(followUp, turn, toolResults) : firstAskTurn(turn, toolResults);
}

/** A follow-up: find the folder, look at the frame it names (an upload), answer. */
function followUpTurn(followUp: FollowUp, turn: number, toolResults: readonly string[]): DemoTurn {
  switch (turn) {
    case 0:
      return use('updatePlan', { steps: [{ text: 'Describe that frame of beach.mov' }] });
    case 1:
      return use('library_listSources', {});
    case 2: {
      const folder = firstPath(toolResults.find((r) => r.includes('"sources":')));
      return {
        text: 'I will look at that frame.',
        ...use('vision_describeFrame', { path: `${folder}/beach.mov`, at: followUp.at }),
      };
    }
    default:
      return { text: followUp.answer };
  }
}

function firstAskTurn(turn: number, toolResults: readonly string[]): DemoTurn {
  const sourceId = () =>
    /"id":"([0-9A-Z]{26})"/.exec(toolResults.find((r) => r.includes('watched_folder')) ?? '')?.[1] ?? '';
  const firstVideo = () => firstPath(toolResults.find((r) => r.includes('"total":')));
  switch (turn) {
    case 0:
      return {
        reasoning: 'Three things to do: add the folder, find the first video in it, then look at that video.',
        ...use('updatePlan', {
          steps: [{ text: 'Add the Trip folder' }, { text: 'Find the first video' }, { text: 'Describe it' }],
        }),
      };
    case 1:
      return use('library_addSource', { path: '~/Desktop/Trip' });
    case 2:
      return { text: 'Added your Trip folder.' };
    case 3:
      return use('library_listFiles', { sourceId: sourceId(), limit: 10 });
    case 4:
      return use('media_probe', { path: firstVideo() });
    case 5:
      return { text: 'The first video is a 2-second 640×360 clip.' };
    case 6:
      return {
        text: 'I will look at one frame.',
        ...use('vision_describeFrame', { path: firstVideo(), at: { value: 1, rate: 1 } }),
      };
    default:
      return { text: GATE_DEMO_ANSWER };
  }
}
