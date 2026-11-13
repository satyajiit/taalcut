// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import type { ProductNotification } from '@taalcut/core';

export const PRODUCT_NOTIFY_MESSAGES = {
  'no-fresh-ideas': {
    title: /*i18n*/ { id: 'notify.products.no-fresh-ideas.title', message: 'No fresh product ideas found' },
    body: /*i18n*/ {
      id: 'notify.products.no-fresh-ideas.body',
      message: 'Add new product information or adjust the topics in Products.',
    },
  },
  'ideas-ready': {
    title: /*i18n*/ { id: 'notify.products.ideas.title', message: 'New product video ideas' },
    body: /*i18n*/ { id: 'notify.products.ideas.body', message: 'Review the shortlist in Products.' },
  },
  'draft-ready': {
    title: /*i18n*/ { id: 'notify.products.draft.title', message: 'Your product video is ready to review' },
    body: /*i18n*/ { id: 'notify.products.draft.body', message: 'Watch the draft and ask Taal for changes.' },
  },
  'approval-required': {
    title: /*i18n*/ { id: 'notify.products.approval.title', message: 'Your approval is needed' },
    body: /*i18n*/ {
      id: 'notify.products.approval.body',
      message: 'Review the video and publishing details in Products.',
    },
  },
  published: {
    title: /*i18n*/ { id: 'notify.products.published.title', message: 'Your product video was published' },
    body: /*i18n*/ {
      id: 'notify.products.published.body',
      message: 'Open Products to see the published posts.',
    },
  },
  failed: {
    title: /*i18n*/ { id: 'notify.products.failed.title', message: 'A product task needs attention' },
    body: /*i18n*/ {
      id: 'notify.products.failed.body',
      message: 'Open Products to review what happened and retry.',
    },
  },
} as const satisfies Record<
  ProductNotification['kind'],
  { title: MessageDescriptor; body: MessageDescriptor }
>;
