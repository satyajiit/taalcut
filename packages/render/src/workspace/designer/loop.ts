// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Designer outside an agent run (HFW1 "dsn"): one model, the Designer's tools, and turns until it answers in
 * words. The template's reading and the make's frame checks (tpl's DesignOverlay, template-designer.ts) and
 * `eval:design` run it; in the chat the agent runs `render.designer` as a step instead, with the same tools and
 * prompt. A call runs as the agent runs a tool: its input parsed, its command dispatched with source 'agent', a
 * refusal going back to the model as the tool's error with what to fix. The newest call with pictures (ToolSpec
 * `images`, `workspace.render`'s stills) has them on its message for a model that sees images; older calls stay
 * words (the agent's tool-images rule). Never throws.
 */
import { z } from 'zod';
import {
  err,
  newId,
  NotFoundError,
  type AnyTool,
  type ArtifactId,
  type ArtifactRef,
  type ArtifactStore,
  type AsyncResult,
  type CommandToolContext,
  type TaalcutError,
} from '@taalcut/core';

export type DesignerPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string };

export interface DesignerCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export type DesignerMessage =
  | { readonly role: 'user'; readonly content: readonly DesignerPart[] }
  | {
      readonly role: 'assistant';
      readonly text: string;
      readonly calls: readonly DesignerCall[];
      /** The model's own message, passed back unchanged (provider signatures). Opaque. */
      readonly native?: unknown;
      readonly model?: string;
    }
  | {
      readonly role: 'tool';
      readonly callId: string;
      readonly name: string;
      readonly content: readonly DesignerPart[];
      readonly isError: boolean;
    };

export interface DesignerToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema of its input. */
  readonly parameters: unknown;
  /** Its input as zod, for a client that converts it itself. */
  readonly schema: z.ZodType;
}

export interface DesignerModelAnswer {
  /** Untrusted. */
  readonly text: string;
  readonly calls: readonly DesignerCall[];
  /** `provider/model`. */
  readonly model: string;
  readonly local: boolean;
  /** The model's own message, for the next turn. Opaque. */
  readonly native?: unknown;
}

/** One designing model (the app's chat model, a cloud or on-device model in the eval, a stand-in in tests). */
export interface DesignerModel {
  /** Whether it takes images: the stills go to it as pictures, else it reads the checks' words. */
  readonly seesImages: boolean;
  turn(
    request: {
      readonly system: string;
      readonly messages: readonly DesignerMessage[];
      readonly tools: readonly DesignerToolDefinition[];
      readonly maxTokens: number;
    },
    signal?: AbortSignal,
  ): AsyncResult<DesignerModelAnswer>;
}

export interface DesignerCallRecord {
  readonly turn: number;
  readonly name: string;
  readonly input: unknown;
  readonly ok: boolean;
  /** A refusal's code and what it said. */
  readonly code?: string;
  readonly detail?: string;
  readonly output?: unknown;
}

export interface DesignerLoopInput {
  readonly model: DesignerModel;
  readonly tools: readonly AnyTool[];
  readonly system: string;
  readonly task: readonly DesignerPart[];
  /** Dispatches a tool's declared command with source 'agent'. */
  readonly dispatch: (command: string, payload: unknown) => AsyncResult<unknown>;
  readonly artifacts: ArtifactStore;
  readonly runId?: string;
  /** Default 30, the Designer skill's most. */
  readonly maxTurns?: number;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
  /**
   * As an agent skill step does (agent turn-context.ts): an answer in words alone gets `note` and another turn, up
   * to `turns` in a row (the agent's MAX_TEXT_TURNS is 3). Absent: the first answer in words ends the loop.
   */
  readonly words?: { readonly turns: number; readonly note: string };
  /** As an agent skill step's last turn: only these tools are offered, with `note`, so it ends with what it made. */
  readonly lastTurn?: { readonly tools: readonly string[]; readonly note: string };
  /** A call that ends the loop once it has run, as an agent step ends on its accepted handOff. */
  readonly endsWith?: (call: DesignerCallRecord) => boolean;
}

export interface DesignerLoopResult {
  /** Its last words. Untrusted. */
  readonly text: string;
  readonly turns: number;
  readonly calls: readonly DesignerCallRecord[];
  /** answered: it stopped calling tools; ended: a call `endsWith` names ran; turns: it ran out; model: a call failed. */
  readonly stopped: 'answered' | 'ended' | 'turns' | 'model' | 'cancelled';
  readonly error?: TaalcutError;
  readonly model?: string;
  readonly local?: boolean;
}

export const DESIGNER_LOOP_TURNS = 30;
/** A tool's words to the model, at most. */
const OUTPUT_CHARS = 16_000;
const PICTURES_MAX = 12;
/** The newest messages kept whole; older ones are condensed so a long design fits a small window (the 9B's 32k). */
const KEPT_WHOLE = 6;
const OLD_OUTPUT_CHARS = 1_200;
const OLD_ARGUMENT_CHARS = 600;
const PICTURE_BYTES_MAX = 4 * 1024 * 1024;

/**
 * A tool's name as the model calls it: 'workspace.write' becomes 'workspace_write', as the agent's tool registry
 * names them (tools' toCallName). Providers refuse a dot in a function's name (OpenAI's Responses API: 400,
 * `^[a-zA-Z0-9_-]+$`); tool names have no underscore, so it reads back. A call by the tool's own name still runs.
 */
export const designerCallName = (name: string): string => name.replace('.', '_');

/** The tools as the model reads them, by their call names. */
export function designerToolDefinitions(tools: readonly AnyTool[]): DesignerToolDefinition[] {
  return tools.map((tool) => ({
    name: designerCallName(tool.name),
    description: tool.description,
    parameters: z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' }),
    schema: tool.input,
  }));
}

const text = (value: string): DesignerPart => ({ type: 'text', text: value });
const words = (value: unknown) => {
  const json = JSON.stringify(value) ?? 'null';
  return json.length > OUTPUT_CHARS ? `${json.slice(0, OUTPUT_CHARS)}… (cut)` : json;
};

interface Ran {
  readonly record: DesignerCallRecord;
  readonly message: string;
  readonly images: readonly ArtifactRef[];
}

async function runCall(input: DesignerLoopInput, call: DesignerCall, turn: number): Promise<Ran> {
  const refuse = (code: string, detail: string): Ran => ({
    record: { turn, name: call.name, input: call.arguments, ok: false, code, detail },
    message: `${code}: ${detail}`,
    images: [],
  });
  const spec = input.tools.find((tool) => tool.name === call.name || designerCallName(tool.name) === call.name);
  if (!spec)
    return refuse(
      'core.not_found',
      `No tool ${call.name}. The tools: ${input.tools.map((t) => designerCallName(t.name)).join(', ')}`,
    );
  // Recorded by the tool's own name, whichever the model called it by.
  const named: DesignerCall = { ...call, name: spec.name };
  return runSpec(input, spec, named, turn);
}

async function runSpec(input: DesignerLoopInput, spec: AnyTool, call: DesignerCall, turn: number): Promise<Ran> {
  const refuse = (code: string, detail: string): Ran => ({
    record: { turn, name: call.name, input: call.arguments, ok: false, code, detail },
    message: `${code}: ${detail}`,
    images: [],
  });
  const parsed = spec.input.safeParse(call.arguments);
  if (!parsed.success) return refuse('core.validation', z.prettifyError(parsed.error));
  const ctx: CommandToolContext = {
    signal: input.signal ?? new AbortController().signal,
    callId: newId<'ToolRun'>(),
    ...(input.runId ? { runId: input.runId as CommandToolContext['runId'] } : {}),
    attempt: 1,
    artifacts: input.artifacts,
    reportUsage: () => undefined,
    reportProgress: () => undefined,
    dispatch: (payload) =>
      spec.command
        ? input.dispatch(spec.command, payload)
        : Promise.resolve(err(NotFoundError({ entity: 'command', id: call.name }))),
  };
  let done;
  try {
    done = await spec.run(parsed.data, ctx as never);
  } catch (cause) {
    return refuse('core.internal', `The tool failed: ${String(cause).slice(0, 300)}`);
  }
  if (!done.ok) return refuse(done.error.code, done.error.detail ?? done.error.code);
  const output = spec.output.safeParse(done.value);
  const value = output.success ? output.data : done.value;
  let images: readonly ArtifactRef[];
  try {
    images = spec.images?.(value as never) ?? [];
  } catch {
    images = [];
  }
  return { record: { turn, name: call.name, input: parsed.data, ok: true, output: value }, message: words(value), images };
}

async function pictures(artifacts: ArtifactStore, refs: readonly ArtifactRef[]): Promise<DesignerPart[]> {
  const parts: DesignerPart[] = [];
  for (const ref of refs.slice(0, PICTURES_MAX)) {
    if (ref.bytes > PICTURE_BYTES_MAX || !ref.mediaType.startsWith('image/')) continue;
    const stored = await artifacts.get(ref.id as ArtifactId);
    if (stored.ok)
      parts.push({ type: 'image', data: Buffer.from(stored.value.data).toString('base64'), mimeType: ref.mediaType });
  }
  return parts;
}

const cut = (value: string, max: number, keep: number, note: string) =>
  value.length > max ? `${value.slice(0, keep)}… (${value.length} chars, ${note})` : value;

/**
 * The history as the model reads it: the task and the newest messages whole; an older tool answer cut to its start,
 * and an older call's long arguments (a file's text it wrote) cut, with its own message dropped so it is rebuilt
 * from the words. A file is in the workspace either way (workspace.read has it).
 */
export function condensed(history: readonly DesignerMessage[]): DesignerMessage[] {
  const whole = history.length - KEPT_WHOLE;
  return history.map((message, index) => {
    if (index === 0 || index >= whole) return message;
    if (message.role === 'tool')
      return {
        ...message,
        content: message.content.flatMap((part) =>
          part.type === 'text' ? [{ type: 'text' as const, text: cut(part.text, OLD_OUTPUT_CHARS, OLD_OUTPUT_CHARS, 'older output, cut') }] : [],
        ),
      };
    if (message.role !== 'assistant') return message;
    const calls = message.calls.map((call) => ({
      ...call,
      arguments: Object.fromEntries(
        Object.entries(call.arguments).map(([key, value]) => [
          key,
          typeof value === 'string' ? cut(value, OLD_ARGUMENT_CHARS, 200, 'as written, in the workspace') : value,
        ]),
      ),
    }));
    const { native: _native, ...rest } = message;
    return { ...rest, calls };
  });
}

/** Runs the Designer until it answers in words, runs out of turns, or a model call fails. */
export async function runDesignerLoop(input: DesignerLoopInput): Promise<DesignerLoopResult> {
  const definitions = designerToolDefinitions(input.tools);
  const lastTools = new Set((input.lastTurn?.tools ?? []).map(designerCallName));
  const maxTurns = input.maxTurns ?? DESIGNER_LOOP_TURNS;
  const history: DesignerMessage[] = [{ role: 'user', content: input.task }];
  const calls: DesignerCallRecord[] = [];
  // The newest tool message with pictures: its index in the history and its refs.
  let pictured: { readonly at: number; readonly refs: readonly ArtifactRef[] } | null = null;
  let last = '';
  let model: string | undefined;
  let local: boolean | undefined;
  const end = (stopped: DesignerLoopResult['stopped'], turns: number, error?: TaalcutError): DesignerLoopResult => ({
    text: last,
    turns,
    calls,
    stopped,
    ...(error ? { error } : {}),
    ...(model ? { model } : {}),
    ...(local !== undefined ? { local } : {}),
  });
  let wordsInARow = 0;
  for (let turn = 1; turn <= maxTurns; turn++) {
    if (input.signal?.aborted) return end('cancelled', turn - 1);
    const final = turn === maxTurns && input.lastTurn !== undefined;
    let messages: readonly DesignerMessage[] = condensed(history);
    if (pictured && input.model.seesImages) {
      const parts = await pictures(input.artifacts, pictured.refs);
      const at = pictured.at;
      messages = messages.map((message, index) =>
        index === at && message.role === 'tool' ? { ...message, content: [...message.content, ...parts] } : message,
      );
    }
    const answer = await input.model.turn(
      {
        system: final ? `${input.system}\n\n${input.lastTurn!.note}` : input.system,
        messages,
        tools: final ? definitions.filter((tool) => lastTools.has(tool.name)) : definitions,
        maxTokens: input.maxTokens ?? 8_000,
      },
      input.signal,
    );
    if (!answer.ok) return end('model', turn - 1, answer.error);
    ({ model, local } = answer.value);
    last = answer.value.text;
    history.push({
      role: 'assistant',
      text: answer.value.text,
      calls: answer.value.calls,
      model: answer.value.model,
      ...(answer.value.native !== undefined ? { native: answer.value.native } : {}),
    });
    if (answer.value.calls.length === 0) {
      wordsInARow++;
      if (!input.words || wordsInARow >= input.words.turns || final) return end('answered', turn);
      history.push({ role: 'user', content: [text(input.words.note)] });
      continue;
    }
    wordsInARow = 0;
    for (const call of answer.value.calls) {
      const ran = await runCall(input, call, turn);
      calls.push(ran.record);
      history.push({ role: 'tool', callId: call.id, name: call.name, content: [text(ran.message)], isError: !ran.record.ok });
      if (ran.images.length > 0) pictured = { at: history.length - 1, refs: ran.images };
      if (input.endsWith?.(ran.record)) return end('ended', turn);
    }
  }
  return end('turns', maxTurns);
}
