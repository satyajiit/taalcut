// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { Id } from '@taalcut/core';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CardView, errorMessage, fixLabel, ImageGeneration, ProviderLogo, toolLabel } from '../src';

const wrap = (node: ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

describe('ImageGeneration & SVGL ProviderLogo coverage', () => {
  it('renders generating state with dither canvas, provider logo, dimensions and prompt', () => {
    wrap(
      <ImageGeneration
        status="generating"
        provider="openai-codex"
        model="gpt-image-1.5"
        width={1024}
        height={1792}
        prompt="Warm dusk neon street in Mumbai"
      >
        <img src="https://example.com/take.png" alt="Generated still" />
      </ImageGeneration>,
    );

    const surface = document.querySelector('[data-slot="image-generation"]');
    expect(surface?.getAttribute('data-status')).toBe('generating');
    expect(surface?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Generating image')).toBeTruthy();
    expect(screen.getByText('gpt-image-1.5')).toBeTruthy();
    expect(screen.getByText('Warm dusk neon street in Mumbai')).toBeTruthy();
    expect(surface?.querySelector('canvas')).not.toBeNull();
  });

  it('transitions to complete and error states with retry callback', () => {
    const onRetry = vi.fn();
    const { rerender } = wrap(
      <ImageGeneration
        status="error"
        provider="xai"
        errorMessage="Rate limit reached on xAI."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('Generation failed')).toBeTruthy();
    expect(screen.getByText('Rate limit reached on xAI.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(
      <I18nProvider i18n={i18n}>
        <ImageGeneration status="complete" provider="xai">
          <img src="https://example.com/ready.png" alt="Ready still" />
        </ImageGeneration>
      </I18nProvider>,
    );
    expect(screen.getByText('Image ready')).toBeTruthy();
  });

  it('renders ImageGeneration inside ToolRunRow when images.generateForSlot is running', () => {
    wrap(
      <CardView
        card={{
          type: 'toolRun',
          id: 'tool-img-1',
          version: 1,
          runId: '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as Id<'AgentRun'>,
          toolRunId: '01K7C5M6Q8R9S0T1V2W3X4Y5Z8' as Id<'ToolRun'>,
          tool: 'images.generateForSlot',
          status: 'running',
          startedAt: 1000,
          summary: 'Golden hour chai stall close-up',
        }}
      />,
    );
    expect(screen.getByText('Generate images for a slot')).toBeTruthy();
    expect(document.querySelector('[data-slot="image-generation"]')).not.toBeNull();
  });

  it('resolves SVGL brand glyphs across all provider and agent aliases', () => {
    const providers = [
      'openai',
      'openai-codex',
      'anthropic',
      'claude-code',
      'google',
      'xai',
      'x-ai/grok-imagine-image-2.0',
      'github-copilot',
      'openrouter',
      'elevenlabs',
      'cloudflare-workers-ai',
      'ollama',
      'cursor',
      'deepseek',
      'mistral',
      'meta',
      'instagram',
      'black-forest-labs',
      'pexels',
      'local',
    ];
    wrap(
      <div>
        {providers.map((p) => (
          <ProviderLogo key={p} provider={p} data-testid={`logo-${p}`} />
        ))}
      </div>,
    );
    for (const p of providers) {
      expect(screen.getByTestId(`logo-${p}`).querySelector('svg')).not.toBeNull();
    }
  });

  it('maps domain tool names, error codes and fix actions to plain English', () => {
    expect(toolLabel(i18n, 'images.generateForSlot')).toBe('Generate images for a slot');
    expect(toolLabel(i18n, 'templates.breakdown')).toBe('Break down the reference video');
    expect(toolLabel(i18n, 'timeline.cast')).toBe('Match your clips to the template');
    expect(
      errorMessage(i18n, {
        code: 'models.image_no_provider',
        messageKey: 'errors.models.image_no_provider',
        retryable: false,
      }),
    ).toContain('Connect ChatGPT images or Grok');
    expect(
      fixLabel(i18n, {
        command: 'ui.openAccounts',
        labelKey: 'fix.openAccounts',
      }),
    ).toBe('Open Accounts');
  });
});
