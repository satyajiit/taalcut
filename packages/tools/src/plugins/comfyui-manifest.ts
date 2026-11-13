// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import type { PluginManifest, PluginSkillContent } from '@taalcut/core';

export const COMFYUI_DEFAULT_URL = 'http://127.0.0.1:8188';

function isLocalOrLanHost(host: string): boolean {
  const name = host.toLowerCase();
  if (['localhost', '[::1]', '127.0.0.1'].includes(name)) return true;
  if (name.endsWith('.ts.net') || name.endsWith('.local') || name.endsWith('.localhost')) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(name)) return false;
  const numbers = name.split('.').map(Number);
  if (numbers.length !== 4 || numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = numbers;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b! >= 64 && b! <= 127)
  );
}

export const comfyuiConfigSchema = z
  .object({
    'server-url': z.string().default(COMFYUI_DEFAULT_URL),
    'default-checkpoint': z.string().default('flux1-schnell-fp8.safetensors'),
  })
  .strict()
  .transform((config, ctx): Record<string, string> => {
    try {
      const url = new URL(config['server-url']);
      if (url.username || url.password || url.search || url.hash) {
        ctx.addIssue({ code: 'custom', message: 'ComfyUI server URL must not contain credentials or query parameters.' });
        return z.NEVER;
      }
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalOrLanHost(url.hostname))) {
        ctx.addIssue({ code: 'custom', message: 'Use https:// or a local/LAN http:// address for ComfyUI.' });
        return z.NEVER;
      }
      const checkpoint = config['default-checkpoint'].trim();
      if (!checkpoint || /[/\\]|\.\./.test(checkpoint)) {
        ctx.addIssue({ code: 'custom', message: 'Provide a valid checkpoint filename without path separators.' });
        return z.NEVER;
      }
      return {
        'server-url': url.origin,
        'default-checkpoint': checkpoint,
      };
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Provide a valid ComfyUI server URL (e.g. http://127.0.0.1:8188).' });
      return z.NEVER;
    }
  });

export const comfyuiManifest: PluginManifest = {
  id: 'comfyui',
  name: 'ComfyUI',
  version: '1.0.0',
  publisher: 'Taalcut',
  summary: 'Generate local stills, textures and B-roll clips on your own ComfyUI server.',
  description:
    'Connect a local or LAN ComfyUI server (Bring Your Own Server under Settings → Advanced) to run FLUX, SDXL, ' +
    'LTX-Video and Wan 2.1 workflows at zero cloud cost while keeping prompts and media on your hardware.',
  logo: 'comfyui',
  homepage: 'https://www.comfy.org',
  docs: 'https://docs.comfy.org',
  features: [
    {
      id: 'system',
      name: 'System status',
      description: 'Inspect GPU devices, VRAM and queue readiness on your ComfyUI server.',
      access: ['system-read'],
    },
    {
      id: 'media-generation',
      name: 'Image & B-roll generation',
      description: 'Queue parameterised image and video-clip workflows and inspect completed outputs.',
      access: ['system-read', 'media-generate'],
    },
  ],
  access: [
    {
      id: 'system-read',
      name: 'Read server & queue status',
      description: 'Read ComfyUI /system_stats and /history/<promptId> outputs.',
    },
    {
      id: 'media-generate',
      name: 'Queue generation workflows',
      description: 'Submit parameterised image and B-roll generation DAGs to /prompt.',
    },
  ],
  credentials: [
    {
      id: 'api-key',
      name: 'Bearer token (optional)',
      description: 'Optional Bearer token if your ComfyUI instance sits behind an authenticated proxy.',
      required: false,
    },
  ],
  configFields: [
    {
      id: 'server-url',
      name: 'ComfyUI server URL',
      description: 'Loopback or LAN address of your ComfyUI server (default http://127.0.0.1:8188).',
      kind: 'url',
      defaultValue: COMFYUI_DEFAULT_URL,
      required: true,
    },
    {
      id: 'default-checkpoint',
      name: 'Default checkpoint',
      description: 'Default checkpoint filename for image workflows.',
      kind: 'string',
      defaultValue: 'flux1-schnell-fp8.safetensors',
      required: true,
    },
  ],
  skills: [
    {
      id: 'generate',
      name: 'Generate local media with ComfyUI',
      description: 'Check GPU status, submit deterministic workflows and poll history on ComfyUI.',
    },
  ],
};

export const comfyuiSkills: readonly PluginSkillContent[] = [
  {
    ...comfyuiManifest.skills[0]!,
    content: `# Generate local media with ComfyUI
Use plugins.describe and plugins.listTools for ComfyUI. If the plugin is inactive, use plugins.requestSetup so the user can enable their local ComfyUI server in Settings.

1. Call \`api.getSystemStats\` (\`plugins.callRead\`) first to verify the ComfyUI server is reachable and has free VRAM.
2. Call \`api.queuePrompt\` (\`plugins.callExternal\`) with a deterministic seed and explicit dimensions matching the slot's aspect ratio (e.g., 576×1024 for 9:16 vertical, 1024×1024 for 1:1).
3. Poll \`api.getHistory\` (\`plugins.callRead\`) with the returned \`promptId\` until \`outputs\` contains the generated image or video filename.`,
  },
];
