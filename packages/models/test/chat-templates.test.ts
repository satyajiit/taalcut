// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-CTX, SPEC "Chat templates": the sidecar renders each model's requests with the model's own chat template,
 * verbatim from its GGUF (held to the GGUF's hash), with one line changed: the tools written as compact JSON.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { llamaCppRuntimeSpec, llamaServerArgs, localRuntimeSpec, mlxServerArgs } from '@taalcut/models';
import {
  COMPACT_TOOL,
  compactToolsTemplate,
  SPACED_TOOL,
} from '../src/local-runtime/chat-templates/chat-template';
import { QWEN3_5_0_8B_CHAT_TEMPLATE } from '../src/local-runtime/chat-templates/qwen3-5-0-8b';
import { QWEN3_5_4B_CHAT_TEMPLATE } from '../src/local-runtime/chat-templates/qwen3-5-4b';

/** sha256 of `tokenizer.chat_template` in each component's GGUF (`_orch/lrn1/logs/ctx/template/gguf-template.py`). */
const OWN = {
  'qwen3.5-4b': {
    template: QWEN3_5_4B_CHAT_TEMPLATE,
    sha256: 'a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715',
  },
  'qwen3.5-0.8b': {
    template: QWEN3_5_0_8B_CHAT_TEMPLATE,
    sha256: '7f0e529032c25183bcd66c7f238da2d377f43be754a94e2725a58c4e16d2ed67',
  },
  // MLX1: chat_template.jinja in the 9B's MLX folder (mlx-community/Qwen3.5-9B-4bit, revision 8b2b98c0) is the 4B's
  // GGUF template byte for byte.
  'qwen3.5-9b': {
    template: QWEN3_5_4B_CHAT_TEMPLATE,
    sha256: 'a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715',
  },
} as const;

const count = (text: string, part: string) => text.split(part).length - 1;

describe('the sidecar chat templates', () => {
  it.each(Object.entries(OWN))("keeps %s's own template verbatim", (_id, own) => {
    expect(createHash('sha256').update(own.template, 'utf8').digest('hex')).toBe(own.sha256);
    expect(count(own.template, SPACED_TOOL)).toBe(1);
  });

  it.each(Object.entries(OWN))('changes only the line that writes a tool, for %s', (_id, own) => {
    const compact = compactToolsTemplate(own.template);
    const before = own.template.split('\n');
    const after = compact.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after.flatMap((line, index) => (line === before[index] ? [] : [[before[index], line]]));
    expect(changed).toEqual([[`        ${SPACED_TOOL}`, `        ${COMPACT_TOOL}`]]);
  });

  it('is what the MLX server runs the 9B with (taalcut-mlx-server renders the same prompt as llama-server)', () => {
    const model = localRuntimeSpec('high', 'darwin-arm64').models.find((m) => m.id === 'qwen3.5-9b')!;
    expect(model.chatTemplate).toBe(compactToolsTemplate(OWN['qwen3.5-9b'].template));
    const args = mlxServerArgs({ model, weights: '/w', port: 1 });
    expect(args[args.indexOf('--chat-template') + 1]).toBe(model.chatTemplate);
  });

  it('is what each served model runs with, after --jinja', () => {
    for (const model of llamaCppRuntimeSpec('recommended').models) {
      const own = new Map(Object.entries(OWN)).get(model.id);
      if (!own) throw new Error(`no own template recorded for ${model.id}`);
      expect(model.chatTemplate, model.id).toBe(compactToolsTemplate(own.template));
      const args = llamaServerArgs({ model, weights: '/w.gguf', port: 1, backend: 'metal' });
      expect(args.indexOf('--chat-template')).toBe(args.indexOf('--jinja') + 1);
      expect(args[args.indexOf('--chat-template') + 1]).toBe(model.chatTemplate);
    }
  });
});
