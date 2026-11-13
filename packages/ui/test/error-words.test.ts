// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ERRWORDS: the kit's error words reach the window's catalogue under the code's own key, and the two errors a
 * chat showed as "Something went wrong" say what happened. apps/desktop's error-words test reads that catalogue for
 * every code the processes define; it can only find a table's words when the table's key is its descriptor's id.
 */
import { i18n } from '@lingui/core';
import type { TaalcutError } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES, errorMessage, errorValues } from '../src/index';

const error = (code: string, params?: TaalcutError['params']): TaalcutError => ({
  code,
  messageKey: `errors.${code}`,
  retryable: false,
  ...(params ? { params } : {}),
});

describe('error words', () => {
  it('key every table entry by its own catalogue id', () => {
    const astray = Object.entries(ERROR_MESSAGES)
      .filter(([key, descriptor]) => !key.startsWith('errors.') || descriptor.id !== key)
      .map(([key]) => key);
    expect(astray).toEqual([]);
  });

  it('say why a chat stopped, not "Something went wrong"', () => {
    expect(
      errorMessage(i18n, error('models.provider_error', { provider: 'openai', model: 'gpt-6-astra' })),
    ).toBe(
      'OpenAI ran into a problem, so the answer stopped. Try again, or pick another model in Settings › Models.',
    );
    expect(errorMessage(i18n, error('agent.turn_limit', { limit: 10 }))).toBe(
      'Taalcut stopped after 10 steps without finishing. Ask it to carry on.',
    );
  });

  it('name the provider as people know it, and leave other values as they are', () => {
    expect(errorValues(i18n, { provider: 'openai-codex', model: 'gpt-6' })).toEqual({
      provider: 'ChatGPT',
      model: 'gpt-6',
    });
    expect(errorValues(i18n, { provider: 'some-new-lab' })).toEqual({ provider: 'some-new-lab' });
    expect(errorValues(i18n, { limit: 10 })).toEqual({ limit: 10 });
    expect(errorValues(i18n, undefined)).toBeUndefined();
  });
});
