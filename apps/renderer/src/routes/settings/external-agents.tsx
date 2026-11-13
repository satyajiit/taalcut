// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: settings external agents · system: DESIGN.md v0.3 · hairline sections */
import { Trans, useLingui } from '@lingui/react/macro';
import { idSchema, type McpSessionId } from '@taalcut/core';
import { createFileRoute } from '@tanstack/react-router';
import { ExternalAgentsSettings } from '../../features/settings/external-agents/external-agents-settings';
import { SettingsPage } from '../../features/settings/settings-page';

const sessionSchema = idSchema<'McpSession'>();

export const Route = createFileRoute('/settings/external-agents')({
  // `session`: the agent an approval card's "Change what it can do" opened.
  validateSearch: (search: Record<string, unknown>): { session?: McpSessionId | undefined } => {
    const parsed = sessionSchema.safeParse(search.session);
    return parsed.success ? { session: parsed.data } : {};
  },
  component: ExternalAgents,
});

function ExternalAgents() {
  const { t } = useLingui();
  const { session } = Route.useSearch();
  return (
    <SettingsPage
      title={t`External agents`}
      description={<Trans>Other AI apps on this Mac that can work in Taalcut, and what each may do.</Trans>}
    >
      <ExternalAgentsSettings highlight={session} />
    </SettingsPage>
  );
}
