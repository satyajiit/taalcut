// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { PrivacySharing } from '../../../features/settings/privacy/privacy-sharing';

/** Settings › Privacy › Sharing (UX4): Help improve Taalcut and everything else that uses the internet. */
export const Route = createFileRoute('/settings/privacy/sharing')({
  component: PrivacySharing,
});
