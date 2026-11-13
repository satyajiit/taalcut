// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test builds only: a stand-in for the embedded llama-server (D16) on a loopback port, speaking its OpenAI
 * Chat Completions wire format, that answers the make flow's journeys with the same script the recorded
 * cloud session was recorded against (apps/gate-demo make-flow-script.ts). The Local only journey (P3-B10)
 * runs the production ModelClient against it: Local only on, the Local only profile, the on-device provider
 * reached over loopback, pi-ai building every request and parsing every stream. Reached only through
 * agent-local-session.ts.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { jsonFromText } from '@taalcut/core';
import {
  isMakeFlowAsk,
  makeFlowTitle,
  makeFlowTurn,
  makeFlowVisionDescription,
  viewOf,
  type DemoTurn,
} from '@taalcut/gate-demo';
import { z } from 'zod';

type AnthropicBody = Parameters<typeof viewOf>[0];
type AnthropicMessage = AnthropicBody['messages'][number];
type AnthropicBlock = Exclude<AnthropicMessage['content'], string>[number];

/** What the stand-in served, one line per request (the e2e checks every turn ran on this Mac). */
export interface ServedTurn {
  readonly model: string;
  readonly kind: 'agent' | 'vision' | 'title';
  readonly ask: string;
}

const partSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  image_url: z.unknown().optional(),
});
const messageSchema = z.looseObject({
  role: z.string(),
  content: z.union([z.string(), z.array(partSchema), z.null()]).optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z
    .array(z.looseObject({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) }))
    .optional(),
});
const requestSchema = z.looseObject({
  model: z.string(),
  messages: z.array(messageSchema),
  tools: z.array(z.looseObject({ function: z.object({ name: z.string() }) })).optional(),
});
type ChatRequest = z.output<typeof requestSchema>;
type ChatMessage = z.output<typeof messageSchema>;

const textOf = (content: ChatMessage['content']): string =>
  typeof content === 'string'
    ? content
    : (content ?? []).flatMap((part) => (part.type === 'text' && part.text ? [part.text] : [])).join('');

const hasImage = (request: ChatRequest) =>
  request.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((part) => part.type === 'image_url'),
  );

/** A tool call's arguments as an object; anything else is no arguments. */
function parseArguments(text: string): Record<string, unknown> {
  const value = jsonFromText(text);
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** The request as the script reads requests: Anthropic's message shape (tool results in user turns). */
export function anthropicView(request: ChatRequest): AnthropicBody {
  const system: string[] = [];
  const messages: AnthropicMessage[] = [];
  const results: AnthropicBlock[] = [];
  const flushResults = () => {
    if (results.length > 0) messages.push({ role: 'user', content: results.splice(0) });
  };
  for (const message of request.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      system.push(textOf(message.content));
      continue;
    }
    if (message.role === 'tool') {
      results.push({
        type: 'tool_result',
        tool_use_id: message.tool_call_id ?? '',
        content: textOf(message.content),
      });
      continue;
    }
    flushResults();
    const text = textOf(message.content);
    const blocks: AnthropicBlock[] = text ? [{ type: 'text', text }] : [];
    for (const call of message.tool_calls ?? [])
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: parseArguments(call.function.arguments),
      });
    messages.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: blocks });
  }
  flushResults();
  return {
    model: request.model,
    system: system.join('\n'),
    messages,
    tools: (request.tools ?? []).map((tool) => ({ name: tool.function.name })),
  };
}

const chunk = (model: string, id: string, choice: Record<string, unknown> | null, usage?: unknown) =>
  `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: 1_760_000_000,
    model,
    choices: choice ? [{ index: 0, ...choice }] : [],
    ...(usage ? { usage } : {}),
  })}\n\n`;

/** One streamed answer, as llama-server sends it. */
export function completionStream(model: string, id: string, reply: DemoTurn, promptTokens: number): string {
  const frames = [chunk(model, id, { delta: { role: 'assistant', content: '' }, finish_reason: null })];
  if (reply.text)
    for (const piece of reply.text.split(/(?<= )/))
      frames.push(chunk(model, id, { delta: { content: piece }, finish_reason: null }));
  if (reply.toolCall)
    frames.push(
      chunk(model, id, {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: `call_${id}`,
              type: 'function',
              function: { name: reply.toolCall.name, arguments: JSON.stringify(reply.toolCall.args) },
            },
          ],
        },
        finish_reason: null,
      }),
    );
  frames.push(
    chunk(model, id, { delta: {}, finish_reason: reply.toolCall ? 'tool_calls' : 'stop' }),
    chunk(model, id, null, {
      prompt_tokens: promptTokens,
      completion_tokens: 60,
      total_tokens: promptTokens + 60,
    }),
    'data: [DONE]\n\n',
  );
  return frames.join('');
}

export interface OnDeviceStandIn {
  /** The OpenAI-compatible base URL (…/v1). */
  readonly baseUrl: string;
  close(): Promise<void>;
}

/** Starts the stand-in on a free loopback port. `served` hears each answered request. */
export async function startOnDeviceStandIn(served: (turn: ServedTurn) => void): Promise<OnDeviceStandIn> {
  let calls = 0;
  // A vision call serves the ask of the agent's call before it; the Analyst describes the reel's shots in turn.
  let lastAsk = '';
  const looked = new Map<string, number>();

  const answer = (request: ChatRequest): { reply: DemoTurn; turn: ServedTurn } => {
    if (hasImage(request)) {
      const index = looked.get(lastAsk) ?? 0;
      looked.set(lastAsk, index + 1);
      const text = isMakeFlowAsk(lastAsk) ? makeFlowVisionDescription(index) : 'A frame of the reel.';
      return { reply: { text }, turn: { model: request.model, kind: 'vision', ask: lastAsk } };
    }
    const view = viewOf(anthropicView(request));
    lastAsk = view.ask;
    if (!request.tools?.length)
      return {
        reply: { text: makeFlowTitle(view.ask) },
        turn: { model: request.model, kind: 'title', ask: view.ask },
      };
    return { reply: makeFlowTurn(view), turn: { model: request.model, kind: 'agent', ask: view.ask } };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const body = await new Promise<string>((resolve, reject) => {
      let text = '';
      req.on('data', (part: Buffer) => (text += part.toString('utf8')));
      req.on('end', () => resolve(text));
      req.on('error', reject);
    });
    const parsed = req.url?.endsWith('/chat/completions')
      ? requestSchema.safeParse(jsonFromText(body))
      : undefined;
    if (!parsed?.success) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `No stand-in for ${req.method ?? ''} ${req.url ?? ''}` } }));
      return;
    }
    calls += 1;
    const { reply, turn } = answer(parsed.data);
    served(turn);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(completionStream(parsed.data.model, `ondevice_${calls}`, reply, Math.ceil(body.length / 4)));
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch((cause: unknown) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: String(cause) } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? (address satisfies AddressInfo).port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
