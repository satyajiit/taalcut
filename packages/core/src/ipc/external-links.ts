// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Web pages a window may open in the person's browser (round P3-3, G8): providers' billing, usage and key
 * pages, the beta terms, the repository. A window can't open a new window (desktop's window-open policy
 * refuses every one), so it asks main through `files.openExternal`, whose input is this schema: https, a host
 * on the list exactly, no user name, password or port. Main checks it again as the call arrives and hands only
 * that URL to the system.
 */
import '../basics/zod-config';
import { z } from 'zod';

export const EXTERNAL_LINK_HOSTS = [
  'platform.openai.com',
  'chatgpt.com',
  'console.anthropic.com',
  'claude.ai',
  'aistudio.google.com',
  'console.cloud.google.com',
  'console.x.ai',
  'openrouter.ai',
  'elevenlabs.io',
  'dash.cloudflare.com',
  'github.com',
  'taalcut.app',
  'postiz.com',
  'docs.postiz.com',
  'app.postiz.com',
  // LNX1-TRM: NVIDIA's licence texts for the CUDA runtime, its driver downloads and its list of CUDA GPUs, and
  // Ubuntu's guide to installing NVIDIA's driver (the NVIDIA GPU setup card).
  'docs.nvidia.com',
  'www.nvidia.com',
  'developer.nvidia.com',
  'ubuntu.com',
] as const;
export type ExternalLinkHost = (typeof EXTERNAL_LINK_HOSTS)[number];

const HOSTS: ReadonlySet<string> = new Set(EXTERNAL_LINK_HOSTS);

/** True for a URL Taalcut opens in the browser: https, a listed host, nothing in front of the host. */
export function isExternalLink(text: string): boolean {
  if (!URL.canParse(text)) return false;
  const url = new URL(text);
  return (
    url.protocol === 'https:' &&
    HOSTS.has(url.hostname) &&
    url.username === '' &&
    url.password === '' &&
    url.port === ''
  );
}

export const externalLinkSchema = z
  .string()
  .max(2048)
  .refine(isExternalLink, { message: 'Not a page Taalcut opens' });
