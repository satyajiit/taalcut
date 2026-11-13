// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The "Notify me" notification's texts (render.finished). Plain descriptors,
 * as menu-messages.ts: main has no Lingui macros. `name` is the render's
 * display name, which the user or the agent chose: plain text.
 */
import type { MessageDescriptor } from '@lingui/core';

export const RENDER_NOTIFY_MESSAGES = {
  ready: {
    title: /*i18n*/ { id: 'notify.render.ready.title', message: 'Your video is ready' },
    body: /*i18n*/ { id: 'notify.render.ready.body', message: '{name} passed its checks and is in Renders.' },
  },
  needsAttention: {
    title: /*i18n*/ { id: 'notify.render.needsAttention.title', message: 'Your video needs a look' },
    body: /*i18n*/ {
      id: 'notify.render.needsAttention.body',
      message: '{name} missed a check. Open Taalcut to see what to fix.',
    },
  },
  failed: {
    title: /*i18n*/ { id: 'notify.render.failed.title', message: 'Your video wasn’t made' },
    body: /*i18n*/ {
      id: 'notify.render.failed.body',
      message: 'Exporting {name} stopped. Open Taalcut to try again.',
    },
  },
} as const satisfies Record<string, { title: MessageDescriptor; body: MessageDescriptor }>;
