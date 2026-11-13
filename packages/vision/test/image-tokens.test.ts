// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { estimateImageTokens, imageTokenFamily } from '@taalcut/vision';

describe('imageTokenFamily', () => {
  it.each([
    ['openai', 'gpt-5.4-mini', 'openai'],
    ['openrouter', 'openai/gpt-5-mini', 'openai'],
    ['azure', 'o4-mini', 'openai'],
    ['anthropic', 'claude-sonnet-5', 'anthropic'],
    ['amazon-bedrock', 'anthropic.claude-haiku-5-5', 'anthropic'],
    ['google', 'gemini-3.5-flash', 'google'],
    ['openrouter', 'google/gemini-3.1-flash-lite', 'google'],
    ['ollama', 'qwen3-vl:4b', 'other'],
    ['mistral', 'pixtral-large', 'other'],
  ] as const)('%s/%s is %s', (provider, model, family) => {
    expect(imageTokenFamily(provider, model)).toBe(family);
  });
});

describe('estimateImageTokens', () => {
  it('OpenAI: 85 + 170 per 512 px tile after fitting 2048 and shrinking the short side to 768', () => {
    expect(estimateImageTokens('openai', 'gpt-5.4-mini', 512, 512)).toBe(255);
    expect(estimateImageTokens('openai', 'gpt-5.4-mini', 768, 432)).toBe(425);
    expect(estimateImageTokens('openai', 'gpt-5.4-mini', 768, 768)).toBe(765);
    // 1920x1080 → short side 768 → 1365x768 → 3 x 2 tiles.
    expect(estimateImageTokens('openai', 'gpt-5.4-mini', 1920, 1080)).toBe(85 + 170 * 6);
  });

  it('Anthropic: width × height / 750, long side 1568, capped near 1600', () => {
    expect(estimateImageTokens('anthropic', 'claude-sonnet-5', 768, 432)).toBe(443);
    expect(estimateImageTokens('anthropic', 'claude-sonnet-5', 4000, 3000)).toBe(1600);
  });

  it('Gemini: 258 up to 384 px, else 258 per 768 px tile', () => {
    expect(estimateImageTokens('google', 'gemini-3.5-flash', 384, 216)).toBe(258);
    expect(estimateImageTokens('google', 'gemini-3.5-flash', 768, 432)).toBe(258);
    expect(estimateImageTokens('google', 'gemini-3.5-flash', 1280, 720)).toBe(516);
  });

  it('others: width × height / 750', () => {
    expect(estimateImageTokens('ollama', 'qwen3-vl:4b', 768, 768)).toBe(787);
  });
});
