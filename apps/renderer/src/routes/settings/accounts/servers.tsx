// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { ServersSettings } from '../../../features/settings/accounts/accounts-manage';

/** Accounts › Servers: bring your own model server (Ollama, LM Studio). */
export const Route = createFileRoute('/settings/accounts/servers')({
  component: ServersSettings,
});
