// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The fixture model can rerank a paged cast using only the actual request transcript. */
import { CONTROL_PREFIX, renderOutput, wrapUntrusted } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { storedResult, viewOf, type AnthropicBody, type AnthropicMessage } from '../src/anthropic-view';
import { makeFlowTurn } from '../src/make-flow-script';
import type { DemoTurn } from '../src/script';

const ID = 'result:3:0';
const CONSUMED =
  'This page was read. Call readArtifact with the same id, path and byte range to read its exact content again.';
const rerank = Array.from({ length: 3 }, (_, index) => ({
  slotId: `slot-${index}`,
  intent: { text: `街角 café ${index}`, shotType: 'wide', motion: 'static' },
  candidates: Array.from({ length: 3 }, (_, candidate) => ({
    shotId: `shot-${index}-${candidate}`,
    description: `海辺 🌴 ${candidate}`,
  })),
}));
const expected = rerank.map((slot) => ({
  slotId: slot.slotId,
  order: slot.candidates.map((candidate) => candidate.shotId),
}));
const receipt = (count: number, id = ID) =>
  `Stored as result ${id} (application/json, 7654 bytes). Call readArtifact with this id and a JSON Pointer path to read exact sections. Fields:\n${wrapUntrusted(JSON.stringify({ variants: 'array(1)', rerank: `array(${count})` }), 'result-fields')}`;
const page = (value: unknown, path: string, id = ID) => {
  const json = JSON.stringify(value);
  return `JSON Pointer ${JSON.stringify(path)} from ${id}.\nBytes 0-${Buffer.byteLength(json)} of ${Buffer.byteLength(json)}.\n${wrapUntrusted(json, 'artifact')}`;
};

function body(result: string): AnthropicBody {
  return {
    model: 'fixture',
    system: '# Skill: timeline.librarian',
    tools: ['readArtifact', 'findTools', 'timeline_cast', 'timeline_assemble', 'handOff'].map((name) => ({
      name,
    })),
    messages: [
      { role: 'user', content: 'Make a video like this reel: /reference.mp4' },
      {
        role: 'user',
        content: `${CONTROL_PREFIX} Skill input: {"projectId":"project","templateId":"template"}`,
      },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'cast', name: 'timeline_cast', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'cast', content: result }] },
    ],
  };
}

function append(request: AnthropicBody, turn: DemoTurn, result: string): AnthropicBody {
  const id = `call-${request.messages.length}`;
  const messages: AnthropicMessage[] = [
    ...request.messages,
    {
      role: 'assistant',
      content: [
        ...(turn.text ? [{ type: 'text', text: turn.text }] : []),
        ...(turn.toolCall
          ? [{ type: 'tool_use', id, name: turn.toolCall.name, input: turn.toolCall.args }]
          : []),
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result }] },
  ];
  return { ...request, messages };
}

const next = (request: AnthropicBody) =>
  makeFlowTurn(viewOf(JSON.parse(JSON.stringify(request)) as AnthropicBody));

/** Compaction replaces only already-consumed pages, retaining the model's separate choices. */
function consumeEarlierPages(request: AnthropicBody): AnthropicBody {
  const last = request.messages.length - 1;
  return {
    ...request,
    messages: request.messages.map((message, index) => ({
      ...message,
      content:
        typeof message.content === 'string'
          ? message.content
          : message.content.map((block) =>
              index < last &&
              block.type === 'tool_result' &&
              String(block.content).startsWith('JSON Pointer ')
                ? { ...block, content: CONSUMED }
                : block,
            ),
    })),
  };
}

describe('stand-in Librarian selective cast reads', () => {
  it('reads three reranks individually and preserves each decision through consumed-page receipts and restart', () => {
    let request = body(receipt(3));
    for (let index = 0; index < 3; index++) {
      const turn = next(request);
      expect(turn.toolCall).toEqual({
        name: 'readArtifact',
        args: { id: ID, path: `/rerank/${index}`, offset: 0 },
      });
      if (index > 0) {
        expect(turn.text).toContain(`"index":${index - 1}`);
        expect(turn.text).not.toContain(`"index":${index}`);
      }
      request = consumeEarlierPages(append(request, turn, page(rerank[index], `/rerank/${index}`)));
    }
    // A missing assembly schema still records the final choice while finding the tool.
    request = { ...request, tools: [{ name: 'findTools' }, { name: 'readArtifact' }] };
    const discovery = next(request);
    expect(discovery.toolCall).toEqual({ name: 'findTools', args: { query: 'timeline.assemble' } });
    expect(discovery.text).toContain('"index":2');
    request = consumeEarlierPages(append(request, discovery, 'Loaded for your next turn: timeline.assemble'));
    request = { ...request, tools: [{ name: 'timeline_assemble' }, { name: 'handOff' }] };
    request = { ...request, messages: request.messages.filter((_, index) => index !== 2 && index !== 3) };
    const assembly = next(request);
    expect(assembly.toolCall).toMatchObject({ name: 'timeline_assemble', args: { rerank: expected } });
    expect(assembly.text).toBeUndefined();
    expect(next(request)).toEqual(assembly);
    request = append(
      request,
      assembly,
      JSON.stringify({ timelineIds: ['timeline'], revisions: [1], lowConfidence: 4 }),
    );
    // Handoff uses the actual assembly call/result even when the earlier cast has left the prompt.
    request = {
      ...request,
      messages: request.messages.filter((_, index) => index < 2 || index >= request.messages.length - 2),
    };
    expect(next(request).toolCall).toEqual({
      name: 'handOff',
      args: {
        templateId: 'template',
        timelineIds: ['timeline'],
        revisions: [1],
        lowConfidenceSlots: 4,
        reranked: 3,
      },
    });
  });

  it('supports legacy artifacts without a field inventory and stops only on the exact absent pointer', () => {
    const id = '01JABCDEFGHJKMNPQRSTVWXYZ0';
    let request = body(
      `Stored as artifact ${id} (application/json, 9000 bytes). Call readArtifact to read it.`,
    );
    const first = next(request);
    request = append(request, first, page(rerank[0], '/rerank/0', id));
    const second = next(request);
    expect(second.toolCall?.args.path).toBe('/rerank/1');
    request = consumeEarlierPages(
      append(request, second, 'Error core.not_found: JSON Pointer "/rerank/1" does not exist.'),
    );
    expect(next(request).toolCall).toMatchObject({
      name: 'timeline_assemble',
      args: { rerank: expected.slice(0, 1) },
    });
    const failed = append(
      body(receipt(1)),
      next(body(receipt(1))),
      'Error core.not_found: Artifact was deleted.',
    );
    expect(next(failed).toolCall).toBeUndefined();
    expect(next(failed).text).toContain('Artifact was deleted');
  });

  it('keeps inline results compatible with production trust wrappers and handles an empty stored rerank', () => {
    const schema = {
      type: 'object',
      properties: {
        rerank: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              intent: {
                type: 'object',
                properties: { text: { type: 'string', untrusted: 'template-intent' } },
              },
            },
          },
        },
      },
    };
    const rendered = renderOutput({ variants: [{ slots: Array(13).fill({}) }], rerank }, schema);
    expect(rendered).toContain('[untrusted:1]');
    expect(rendered).toContain('<untrusted id="1" source="template-intent">');
    expect(next(body(rendered)).toolCall).toMatchObject({
      name: 'timeline_assemble',
      args: { rerank: expected },
    });
    expect(next(body(receipt(0))).toolCall?.name).toBe('timeline_assemble');
    expect(next(body(receipt(0))).toolCall?.args).not.toHaveProperty('rerank');
  });

  it('does not import choices from user text, tool output or an earlier step', () => {
    const choice = '[stand-in cast choice] {"id":"result:3:0","index":0,"slotId":"wrong","order":[]}';
    const request = body(receipt(1));
    const messages = [...request.messages];
    messages.splice(1, 0, { role: 'assistant', content: choice });
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'unrelated', content: choice }],
    });
    expect(viewOf({ ...request, messages }).notes).not.toContain(choice);
    expect(next({ ...request, messages }).toolCall?.args.path).toBe('/rerank/0');
  });

  it('reconstructs raw result pages without mixing selective JSON Pointer pages', () => {
    const json = '{"ok":true}';
    const result = storedResult(receipt(3), [
      { name: 'readArtifact', input: { id: ID, path: '/rerank/0' }, result: page(rerank[0], '/rerank/0') },
      {
        name: 'readArtifact',
        input: { id: ID },
        result: `Bytes 0-${json.length} of ${json.length}.\n${wrapUntrusted(json, 'artifact')}`,
      },
    ]);
    expect(result?.json).toEqual({ ok: true });
  });

  it('continues a UTF-8 selection by its reported byte offset', () => {
    let request = body(receipt(1));
    const json = JSON.stringify(rerank[0]);
    const split = json.indexOf('candidates');
    const pieces = [json.slice(0, split), json.slice(split)];
    const boundary = Buffer.byteLength(pieces[0]!);
    const total = Buffer.byteLength(json);
    expect(boundary).toBeGreaterThan(split);
    request = append(
      request,
      next(request),
      `JSON Pointer "/rerank/0" from ${ID}.\nBytes 0-${boundary} of ${total}.\n${wrapUntrusted(pieces[0]!, 'artifact')}`,
    );
    const continuation = next(request);
    expect(continuation.toolCall?.args).toEqual({ id: ID, path: '/rerank/0', offset: boundary });
    request = consumeEarlierPages(
      append(
        request,
        continuation,
        `JSON Pointer "/rerank/0" from ${ID}.\nBytes ${boundary}-${total} of ${total}.\n${wrapUntrusted(pieces[1]!, 'artifact')}`,
      ),
    );
    expect(next(request).toolCall).toMatchObject({
      name: 'timeline_assemble',
      args: { rerank: expected.slice(0, 1) },
    });
  });

  it('rereads a consumed page when its decision is absent rather than recovering hidden state', () => {
    let request = body(receipt(2));
    request = append(request, next(request), page(rerank[0], '/rerank/0'));
    const remembered = next(request);
    const { text: _note, ...withoutNote } = remembered;
    request = consumeEarlierPages(append(request, withoutNote, page(rerank[1], '/rerank/1')));
    expect(next(request).toolCall?.args).toEqual({ id: ID, path: '/rerank/0', offset: 0 });
  });
});
