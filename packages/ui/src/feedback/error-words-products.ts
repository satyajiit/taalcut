// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export const PRODUCT_ERROR_WORDS: Readonly<Record<string, MessageDescriptor>> = {
  'errors.agent.product_no_evidence': msg({
    id: 'errors.agent.product_no_evidence',
    message:
      'There isn’t enough readable product information yet. Attach a project folder or public website, then research again.',
  }),
  'errors.agent.product_no_fresh_ideas': msg({
    id: 'errors.agent.product_no_fresh_ideas',
    message:
      'The available ideas overlap with recent videos. Add new product information or adjust the topics and research again.',
  }),
  'errors.agent.product_archived': msg({
    id: 'errors.agent.product_archived',
    message: 'This product is archived. Restore it before researching or creating another video.',
  }),
  'errors.agent.product_draft_limit': msg({
    id: 'errors.agent.product_draft_limit',
    message:
      'This product reached its daily draft limit. Wait until the next day or raise the limit in its preferences.',
  }),
  'errors.agent.product_evidence_changed': msg({
    id: 'errors.agent.product_evidence_changed',
    message:
      'The product or its sources changed while Taalcut was working. Research again to use the latest information.',
  }),
  'errors.jobs.invalid_schedule': msg({
    id: 'errors.jobs.invalid_schedule',
    message:
      'This schedule needs a valid time zone, local time and at least one day of the week. Update it and save again.',
  }),
  'errors.desktop.background_registration_failed': msg({
    id: 'errors.desktop.background_registration_failed',
    message:
      'The operating system couldn’t update background scheduling. Check its background-app settings and try again. Your activity inbox is still available.',
  }),
};
