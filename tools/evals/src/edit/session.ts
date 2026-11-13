// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the edit eval's model client. A docked message's run has no planning turn (agent SPEC 38): its one step
 * is the Editor's. Only the Editor's turns go to a model: the live one (the 9B on MLX, live.ts), or a recorded
 * session that replays them in order, for CI. Any other turn of the run (its closing line) is scripted.
 */
import { err, ok, type Result } from '@taalcut/core';
import { runMessageIndex, scriptedResult, streamOf } from '@taalcut/agent';
import type { ModelClient, ModelRequest, ModelResult, ModelStream } from '@taalcut/models';

/** One case's recorded Editor turns (what the model answered, in order) and the verdict the live run got. */
export interface Session {
  readonly caseId: string;
  readonly model: string;
  readonly verdict: { readonly pass: boolean; readonly why: string };
  readonly turns: readonly ModelResult[];
}

/** The agent marks skill identity separately from its editable persona and instructions. */
export const isEditorTurn = (request: ModelRequest) =>
  /^# Skill: timeline\.editor$/m.test(request.system ?? '');

export interface SessionClient extends ModelClient {
  /** The Editor's turns this run, as answered. */
  readonly turns: ModelResult[];
  /** The Editor's requests this run (the prompt it saw, the tools offered). */
  readonly requests: ModelRequest[];
}

export interface SessionClientOptions {
  /** The model the Editor's turns go to. */
  readonly live?: ModelClient;
  /** Or a recorded session to replay. */
  readonly replay?: Session;
}

const NO_MODEL = {
  code: 'models.unavailable',
  messageKey: 'errors.models.unavailable',
  retryable: false,
  detail: 'the recorded session has no more turns',
} as const;

export function createSessionClient(options: SessionClientOptions): SessionClient {
  const turns: ModelResult[] = [];
  const requests: ModelRequest[] = [];
  let replayed = 0;

  async function editorTurn(request: ModelRequest): Promise<Result<ModelResult>> {
    requests.push(request);
    if (options.replay) {
      const recorded = options.replay.turns[replayed++];
      if (!recorded) return err(NO_MODEL);
      turns.push(recorded);
      return ok(recorded);
    }
    if (!options.live) return err(NO_MODEL);
    const answer = await options.live.complete(request);
    if (answer.ok) turns.push(answer.value);
    return answer;
  }

  /** The run's own turns, after the Editor handed off: a closing line. */
  function runTurn(request: ModelRequest): ModelResult {
    const since = request.messages.slice(Math.max(0, runMessageIndex(request.messages)));
    const turn = since.filter((message) => message.role === 'assistant').length;
    return scriptedResult(request, { text: 'Done.' }, turn);
  }

  const client: SessionClient = {
    turns,
    requests,
    stream(request): ModelStream {
      if (!isEditorTurn(request)) return streamOf(ok(runTurn(request)));
      const outcome = editorTurn(request);
      return {
        result: () => outcome,
        async *[Symbol.asyncIterator]() {
          yield* streamOf(await outcome);
        },
      };
    },
    complete(request) {
      return client.stream(request).result();
    },
  };
  return client;
}

/** A finished run's Editor turns as a session to keep (latency zeroed, so a re-record changes only what changed). */
export function sessionOf(
  caseId: string,
  model: string,
  verdict: Session['verdict'],
  turns: readonly ModelResult[],
): Session {
  return { caseId, model, verdict, turns: turns.map((turn) => ({ ...turn, latencyMs: 0 })) };
}
