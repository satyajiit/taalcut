// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for Anthropic's Messages API, in process: the upstream the
 * recorded sessions are recorded against when there is no key (or no wish
 * to spend). It answers the gate demo's script (script.ts) and the make
 * flow's journeys (make-flow-script.ts) in Anthropic's streaming wire
 * format, so the recording holds pi-ai's real requests and replay runs
 * pi-ai's real SSE parsing. Record against the real API by passing
 * globalThis.fetch and a key to createRecordedModels instead.
 */
import type { FetchFn } from '@taalcut/models';
import {
  blockText,
  runStart,
  said,
  viewOf,
  type AnthropicBody,
  type AnthropicMessage,
} from './anthropic-view';
import { editChatTurn, isEditChatAsk } from './edit-chat-script';
import { editDesignTurn, isEditDesignAsk } from './edit-design-script';
import { isMakeFlowAsk, makeFlowTitle, makeFlowTurn, makeFlowVisionDescription } from './make-flow-script';
import { CLOUD_VISION, FRAME_DESCRIPTION, GATE_DEMO_TITLE, gateDemoTurn, type DemoTurn } from './script';

export { runMessageText, runStart } from './anthropic-view';

const AGENT_USAGE = { input: 1200, output: 80 };
const VISION_USAGE = { input: 700, output: 40 };
const TITLE_USAGE = { input: 150, output: 8 };

export function createStandInProvider(): FetchFn {
  let calls = 0;
  // A vision call serves the ask of the agent's call before it; the make flow describes its shots in turn.
  let lastAsk = '';
  const looked = new Map<string, number>();
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!url.pathname.endsWith('/v1/messages') || typeof init?.body !== 'string') {
      const error = {
        type: 'error',
        error: { type: 'not_found_error', message: `No stand-in for ${url.pathname}` },
      };
      return new Response(JSON.stringify(error), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const body = JSON.parse(init.body) as AnthropicBody;
    calls += 1;
    const vision = body.model === CLOUD_VISION.model;
    // The agent's model without tools: the chat's title, after the first exchange.
    const title = !vision && !body.tools?.length;
    let reply: DemoTurn;
    if (vision) {
      const index = looked.get(lastAsk) ?? 0;
      looked.set(lastAsk, index + 1);
      reply = { text: isMakeFlowAsk(lastAsk) ? makeFlowVisionDescription(index) : FRAME_DESCRIPTION };
    } else {
      const view = viewOf(body);
      lastAsk = view.ask;
      const make = isMakeFlowAsk(view.ask);
      // EDT1-CTX: the docked chat's change, after the make flow made the video (its ask comes last).
      const edit = isEditChatAsk(view.ask);
      // HFW1-UI: the docked chat's designed graphic, which the Editor hands to the Designer.
      const design = isEditDesignAsk(view.ask);
      reply = title
        ? {
            text: edit
              ? 'A shorter clip'
              : design
                ? 'A newspaper headline'
                : make
                  ? makeFlowTitle(view.ask)
                  : GATE_DEMO_TITLE,
          }
        : edit
          ? editChatTurn(view, body.messages)
          : design
            ? editDesignTurn(view)
            : make
              ? makeFlowTurn(view)
              : gateTurn(body.messages);
    }
    const usage = vision ? VISION_USAGE : title ? TITLE_USAGE : AGENT_USAGE;
    const events = messageEvents(body.model, reply, `gate_${calls}`, usage);
    return new Response(events.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

/** The gate demo's turn: by the run's assistant turns so far and every tool result in it. */
function gateTurn(messages: readonly AnthropicMessage[]): DemoTurn {
  const run = messages.slice(Math.max(0, runStart(messages)));
  return gateDemoTurn(
    run.filter((m) => m.role === 'assistant').length,
    toolResults(run),
    said(run[0]?.content),
  );
}

function toolResults(messages: readonly AnthropicMessage[]): string[] {
  return messages.flatMap((m) =>
    typeof m.content === 'string'
      ? []
      : m.content.filter((b) => b.type === 'tool_result').map((b) => blockText(b.content)),
  );
}

const sse = (type: string, data: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/** A few deltas per block, so the stream looks like one. */
const pieces = (text: string) => text.split(/(?<= )/);

function messageEvents(
  model: string,
  reply: DemoTurn,
  id: string,
  usage: { readonly input: number; readonly output: number },
): string[] {
  const events = [
    sse('message_start', {
      message: {
        id: `msg_${id}`,
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: usage.input,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 1,
        },
      },
    }),
  ];
  let index = 0;
  const block = (start: Record<string, unknown>, deltas: Record<string, unknown>[]) => {
    events.push(sse('content_block_start', { index, content_block: start }));
    for (const delta of deltas) events.push(sse('content_block_delta', { index, delta }));
    events.push(sse('content_block_stop', { index }));
    index += 1;
  };
  if (reply.reasoning) {
    block({ type: 'thinking', thinking: '', signature: '' }, [
      ...pieces(reply.reasoning).map((thinking) => ({ type: 'thinking_delta', thinking })),
      { type: 'signature_delta', signature: `sig_${id}` },
    ]);
  }
  if (reply.text)
    block(
      { type: 'text', text: '' },
      pieces(reply.text).map((text) => ({ type: 'text_delta', text })),
    );
  if (reply.toolCall) {
    block({ type: 'tool_use', id: `toolu_${id}`, name: reply.toolCall.name, input: {} }, [
      { type: 'input_json_delta', partial_json: JSON.stringify(reply.toolCall.args) },
    ]);
  }
  events.push(
    sse('message_delta', {
      delta: { stop_reason: reply.toolCall ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: usage.output },
    }),
    sse('message_stop', {}),
  );
  return events;
}
