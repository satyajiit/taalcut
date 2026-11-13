// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT1: tool-call markup a local server left in the text joins its one call; other text is left alone. */
import { describe, expect, it } from 'vitest';
import { mendLeakedMarkup } from '../src/client/leaked-markup';
import type { AssistantChatMessage } from '../src/client/messages';

const message = (text: string, calls = 1): AssistantChatMessage => ({
  role: 'assistant',
  provider: 'local',
  model: 'qwen3.5-9b',
  parts: [
    { type: 'text', text },
    ...Array.from({ length: calls }, (_, i) => ({
      type: 'tool_call' as const,
      call: {
        id: `c${i}`,
        name: 'readArtifact',
        arguments: { id: '01M6AE82ZRH6J3G39ZD69WVJPF', limit: 8192 },
      },
    })),
  ],
});

describe('markup a local server left in the text', () => {
  it('joins the call it belongs to (the 9B on MLX lost its offset)', () => {
    const mended = mendLeakedMarkup(
      message(
        '\n</parameter>\n<parameter=offset>\n16384\n</parameter>\n<parameter=limit>\n10\n</parameter>\n</function>\n',
      ),
    );
    expect(mended.parts).toEqual([
      {
        type: 'tool_call',
        call: {
          id: 'c0',
          name: 'readArtifact',
          arguments: { id: '01M6AE82ZRH6J3G39ZD69WVJPF', limit: 8192, offset: 16384 },
        },
      },
    ]);
  });

  it('is left alone beside words, with two calls, or with none', () => {
    const words = message('Reading the next page.\n<parameter=offset>\n16384\n</parameter>');
    expect(mendLeakedMarkup(words)).toBe(words);
    const two = message('<parameter=offset>\n1\n</parameter>', 2);
    expect(mendLeakedMarkup(two)).toBe(two);
    const plain = message('Done.');
    expect(mendLeakedMarkup(plain)).toBe(plain);
  });
});
