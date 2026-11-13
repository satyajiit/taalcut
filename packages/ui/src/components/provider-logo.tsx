// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: provider-logo · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * SVGL vector marks for model and cloud providers, rendered with theme-aware tokens so every mark reads
 * cleanly on both warm-paper light and carbon-studio dark surfaces. */

import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';
import { AvartanMark } from '../window/avartan-mark';
import {
  DaVinciGlyph,
  FinalCutGlyph,
  HyperFramesGlyph,
  PremiereGlyph,
  TikTokGlyph,
  YouTubeShortsGlyph,
} from './platform-glyphs';
import {
  CursorGlyph,
  DeepSeekGlyph,
  FluxGlyph,
  InstagramGlyph,
  MetaGlyph,
  MistralGlyph,
  PexelsGlyph,
} from './provider-glyphs-extra';

export type ProviderLogoSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ProviderLogoProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Provider identifier (e.g. 'openai', 'anthropic', 'google', 'xai', 'ollama', 'on-device'). */
  provider: string;
  /** Visual size of the badge or icon. Defaults to 'md'. */
  size?: ProviderLogoSize;
  /** Whether to wrap the vector mark in a subtle raised surface tile. Defaults to true. */
  framed?: boolean;
}

const FRAME_SIZE: Record<ProviderLogoSize, string> = {
  xs: cn('size-5 rounded-sm'),
  sm: cn('size-6 rounded-sm'),
  md: cn('size-8 rounded-md'),
  lg: cn('size-10 rounded-md'),
};

const ICON_SIZE: Record<ProviderLogoSize, string> = {
  xs: 'size-3',
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
};

// Authentic SVGL vector paths (24x24 viewBox) for each AI provider.
const OPENAI_PATH =
  'M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z';

const ANTHROPIC_PATH =
  'M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z';

const XAI_PATH =
  'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';

const ELEVENLABS_PATH = 'M6.5 3.5h3.75v17H6.5v-17zm7.25 0h3.75v17h-3.75v-17z';

const OPENROUTER_PATH =
  'M3 10.5h4.2l4.3-4.3h5.5V4l4 3.5-4 3.5V8.8h-4.6L9.1 12l3.3 3.2H17V13l4 3.5-4 3.5v-2.2h-5.5l-4.3-4.3H3v-3z';

const CLOUDFLARE_PATH =
  'M16.509 16.844l.524-1.808c.11-.38.069-.73-.116-.985-.17-.236-.456-.375-.805-.393l-6.59-.084a.215.215 0 0 1-.182-.106.222.222 0 0 1-.015-.214c.063-.157.216-.265.394-.277l6.65-.085c.79-.036 1.644-.675 1.944-1.458l.38-.993a.37.37 0 0 0 .018-.205 5.47 5.47 0 0 0-10.562-.427 2.473 2.473 0 0 0-1.716-.474 2.51 2.51 0 0 0-2.185 1.984c-.05.24-.068.48-.057.717A3.498 3.498 0 0 0 1 15.46c0 .193.016.385.048.573a.24.24 0 0 0 .237.204h14.956a.296.296 0 0 0 .268-.393zm2.905-3.418c-.078 0-.155.003-.232.008a.186.186 0 0 0-.165.134l-.357 1.237c-.11.38-.069.73.116.985.17.236.456.375.805.393l1.41.084c.104.006.195.063.235.152.043.092.033.2-.026.283-.064.092-.168.15-.285.158l-1.47.084c-.794.037-1.648.676-1.947 1.459l-.107.28c-.04.104.035.213.148.213h5.043a.248.248 0 0 0 .24-.184A3.597 3.597 0 0 0 23 16.84c0-1.888-1.534-3.414-3.586-3.414z';

const COPILOT_PATH =
  'M12 2C7.58 2 4 4.79 4 8.5c0 1.45.54 2.78 1.47 3.85-.31.88-.47 1.83-.47 2.82C5 18.94 8.13 22 12 22s7-3.06 7-6.83c0-.99-.16-1.94-.47-2.82A6.13 6.13 0 0 0 20 8.5C20 4.79 16.42 2 12 2zm-3.25 6.25h2.25c.69 0 1.25.56 1.25 1.25v1.5c0 .69-.56 1.25-1.25 1.25H8.75c-.69 0-1.25-.56-1.25-1.25V9.5c0-.69.56-1.25 1.25-1.25zm4.25 0h2.25c.69 0 1.25.56 1.25 1.25v1.5c0 .69-.56 1.25-1.25 1.25H13c-.69 0-1.25-.56-1.25-1.25V9.5c0-.69.56-1.25 1.25-1.25zM8.5 15.5h7a2.5 2.5 0 0 1-2.5 2.5h-2a2.5 2.5 0 0 1-2.5-2.5z';

const OLLAMA_PATH =
  'M8.5 2.5a2.25 2.25 0 0 0-2.25 2.25v1.83A5.48 5.48 0 0 0 5 10.1v7.4A4 4 0 0 0 9 21.5h6a4 4 0 0 0 4-4v-7.4a5.48 5.48 0 0 0-1.25-3.52V4.75a2.25 2.25 0 0 0-4.5 0v.4a5.54 5.54 0 0 0-2.5 0v-.4A2.25 2.25 0 0 0 8.5 2.5zm0 1.75c.28 0 .5.22.5.5v1.32l.65-.18a4.02 4.02 0 0 1 2.7 0l.65.18V4.75a.5.5 0 0 1 1 0v2.52l.37.36c.56.55.88 1.3.88 2.1v7.77a2.25 2.25 0 0 1-2.25 2.25H9a2.25 2.25 0 0 1-2.25-2.25V9.73c0-.8.32-1.55.88-2.1L8 7.27V4.75c0-.28.22-.5.5-.5zm1.25 5.25a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm4.5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-3.75 3.75a1.5 1.5 0 0 0 3 0h-3z';

const LM_STUDIO_PATH =
  'M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.18l6.63 3.68L12 11.54 5.37 7.86 12 4.18zM4.75 9.52l6.38 3.54v6.76l-6.38-3.54V9.52zm14.5 0v6.76l-6.38 3.54v-6.76l6.38-3.54z';

const APPLE_SILICON_PATH =
  'M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.96 6.33c.67-.81 1.12-1.94 1-3.08-.96.04-2.13.64-2.82 1.45-.61.7-.115 1.85-.99 2.97 1.07.08 2.15-.53 2.81-1.34';

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        className="fill-info-strong"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        className="fill-success-strong"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        className="fill-warning-strong"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        className="fill-danger-strong"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function normalizeProviderKey(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const slash = lower.indexOf('/');
  return slash > 0 ? lower.slice(0, slash) : lower;
}

function renderMark(provider: string, iconClass: string) {
  const key = normalizeProviderKey(provider);
  if (key === 'taalcut') return <AvartanMark className={iconClass} />;
  if (key === 'google' || key === 'gemini' || key === 'vertex') return <GoogleMark className={iconClass} />;
  if (key === 'cursor') return <CursorGlyph className={cn(iconClass, 'text-ink')} />;
  if (key === 'deepseek') return <DeepSeekGlyph className={cn(iconClass, 'text-info-strong')} />;
  if (key === 'mistral' || key === 'mistralai')
    return <MistralGlyph className={cn(iconClass, 'text-warning-strong')} />;
  if (key === 'meta' || key === 'meta-llama' || key === 'llama')
    return <MetaGlyph className={cn(iconClass, 'text-info-strong')} />;
  if (key === 'instagram' || key === 'reels')
    return <InstagramGlyph className={cn(iconClass, 'text-primary-strong')} />;
  if (key === 'youtube' || key === 'shorts' || key === 'youtubeav1')
    return <YouTubeShortsGlyph className={cn(iconClass, 'text-danger-strong')} />;
  if (key === 'tiktok') return <TikTokGlyph className={cn(iconClass, 'text-ink')} />;
  if (key === 'davinci' || key === 'otio')
    return <DaVinciGlyph className={cn(iconClass, 'text-info-strong')} />;
  if (key === 'premiere') return <PremiereGlyph className={cn(iconClass, 'text-ai-strong')} />;
  if (key === 'finalcut' || key === 'fcpxml')
    return <FinalCutGlyph className={cn(iconClass, 'text-warning-strong')} />;
  if (key === 'hyperframes') return <HyperFramesGlyph className={cn(iconClass, 'text-primary-strong')} />;
  if (key === 'black-forest-labs' || key === 'flux' || key === 'bfl')
    return <FluxGlyph className={cn(iconClass, 'text-ink')} />;
  if (key === 'pexels') return <PexelsGlyph className={cn(iconClass, 'text-success-strong')} />;

  let path: string;
  let toneClass: string;

  switch (key) {
    case 'openai':
    case 'openai-codex':
    case 'openai-codex-images':
    case 'chatgpt':
    case 'codex':
    case 'gpt':
      path = OPENAI_PATH;
      toneClass = 'text-ink';
      break;
    case 'anthropic':
    case 'claude':
    case 'claude-code':
      path = ANTHROPIC_PATH;
      toneClass = 'text-primary-strong';
      break;
    case 'xai':
    case 'x-ai':
    case 'grok':
    case 'supergrok':
      path = XAI_PATH;
      toneClass = 'text-ink';
      break;
    case 'elevenlabs':
    case 'eleven-labs':
      path = ELEVENLABS_PATH;
      toneClass = 'text-ink';
      break;
    case 'openrouter':
    case 'open-router':
      path = OPENROUTER_PATH;
      toneClass = 'text-ai-strong';
      break;
    case 'cloudflare-workers-ai':
    case 'cloudflare':
    case 'r2':
      path = CLOUDFLARE_PATH;
      toneClass = 'text-warning-strong';
      break;
    case 'github-copilot':
    case 'copilot':
    case 'github':
      path = COPILOT_PATH;
      toneClass = 'text-info-strong';
      break;
    case 'ollama':
      path = OLLAMA_PATH;
      toneClass = 'text-ink';
      break;
    case 'lm-studio':
    case 'lmstudio':
      path = LM_STUDIO_PATH;
      toneClass = 'text-ai-strong';
      break;
    case 'local':
    case 'local-only':
    case 'local-llm':
    case 'local-whisper':
    case 'local-vision':
    case 'local-embed':
    case 'local-beats':
    case 'on-device':
    case 'this-mac':
    case 'apple':
    case 'device':
    case 'devicehevc':
    case 'deviceav1':
    case 'mlx':
    case 'coreml':
    case 'onnx':
    case 'sherpa-onnx':
    case 'whisper-cpp':
      path = APPLE_SILICON_PATH;
      toneClass = 'text-you-strong';
      break;
    default:
      path = LM_STUDIO_PATH;
      toneClass = 'text-ink-2';
      break;
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn(iconClass, 'fill-current', toneClass)}>
      <path d={path} />
    </svg>
  );
}

/**
 * Renders the SVGL brand mark for a model or cloud provider. Adapts to both
 * warm-paper light and carbon-studio dark themes without raw hex values.
 */
export function ProviderLogo({
  provider,
  size = 'md',
  framed = true,
  className,
  ...props
}: ProviderLogoProps) {
  const icon = renderMark(provider, cn('shrink-0', ICON_SIZE[size]));
  if (!framed) {
    return (
      <span
        data-slot="provider-logo"
        data-provider={provider}
        className={cn('inline-flex shrink-0 items-center justify-center', className)}
        {...props}
      >
        {icon}
      </span>
    );
  }
  return (
    <span
      data-slot="provider-logo"
      data-provider={provider}
      className={cn(
        'inline-flex shrink-0 items-center justify-center border border-rule-subtle bg-raised shadow-xs',
        FRAME_SIZE[size],
        className,
      )}
      {...props}
    >
      {icon}
    </span>
  );
}
