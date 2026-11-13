// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · page: Settings › External agents (P3-V4) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 + UX4 · the kit's PageSections: the switch first (its words the hit area) (off by default, D18) with the server's state in
 *   words; then Connect an agent; then the agents connected, newest first. No key is ever on this page.
 * states: loading (the named skeleton) · error (LoadError, Try again) · off ("No agent can reach Taalcut."; the
 *   Connect form waits until the switch is on) · starting ·
 *   listening (on this Mac only, the address) · server failed (the cause and Try again) · no agents yet (one line) ·
 *   agents (rows) · a row highlighted from an approval card
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { MCP_COMMANDS, type McpSessionId, type McpState } from '@taalcut/core';
import { Button, EmptyState, ErrorLine, PageSection, Skeleton, VERB_ICONS } from '@taalcut/ui';
import { useReducer } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcStream } from '../../../backend/use-rpc';
import { LoadError } from '../fields';
import { SETTINGS_ICONS } from '../settings-icons';
import { usePersonCommand } from '../privacy/use-person-command';
import { SwitchRow } from '../switch-row';
import { ConnectAgent } from './connect-agent';
import { ExternalAgentsBones } from './external-agents-bones';
import { SessionRow } from './session-row';

function ServerLine({ server, onRetry }: { server: McpState['server']; onRetry: () => void }) {
  switch (server.state) {
    case 'off':
      return <Trans>Off. No agent can reach Taalcut.</Trans>;
    case 'starting':
      return <Trans>Starting…</Trans>;
    case 'listening': {
      const url = server.url ?? `http://127.0.0.1:${server.port}/mcp`;
      return (
        <Trans>
          Listening on this Mac only, at{' '}
          <span translate="no" className="tc-mono">
            {url}
          </span>
        </Trans>
      );
    }
    case 'error':
      return server.error ? (
        <ErrorLine error={server.error} onRetry={onRetry} />
      ) : (
        <span className="flex flex-wrap items-center gap-3">
          <Trans>Taalcut couldn’t start listening. Try again.</Trans>
          <Button size="sm" icon={VERB_ICONS.retry} onClick={onRetry}>
            <Trans>Try again</Trans>
          </Button>
        </span>
      );
  }
}

export function ExternalAgentsSettings({ highlight }: { highlight?: McpSessionId | undefined }) {
  const backend = useBackend();
  // Try again re-opens the stream (a new round).
  const [round, retry] = useReducer((n: number) => n + 1, 0);
  const state = useRpcStream((signal) => backend.mcp.changed(undefined, { signal }), [backend, round]);
  const person = usePersonCommand();
  if (!state.data) {
    if (state.error)
      return (
        <LoadError error={state.error} onRetry={retry} what={<Trans>External agents didn’t load.</Trans>} />
      );
    return (
      <Skeleton name="settings-external-agents" loading fixture={<ExternalAgentsBones />}>
        {null}
      </Skeleton>
    );
  }
  const { enabled, server, sessions } = state.data;
  const setEnabled = (on: boolean) => void person.run('enabled', MCP_COMMANDS.setEnabled, { enabled: on });
  // The same Skeleton as while loading: one instance from loading to loaded.
  return (
    <Skeleton name="settings-external-agents" loading={false} fixture={<ExternalAgentsBones />}>
      <div className="flex flex-col gap-10 [&>[data-slot=page-section]]:mt-0!">
        <PageSection title={<Trans>Agents on this Mac</Trans>} icon={SETTINGS_ICONS.externalAgents}>
          <SwitchRow
            data-setting="mcp"
            label={<Trans>Let agents on this Mac use Taalcut</Trans>}
            description={
              <Trans>
                Apps like Claude Code or Codex can search your clips, edit and export, at the level you give
                each one. Anything that costs money or exports still asks you here.
              </Trans>
            }
            checked={enabled}
            busy={person.busy('enabled')}
            error={person.error('enabled')}
            onChange={setEnabled}
          />
          <div role="status" className="type-body text-ink-2">
            <ServerLine
              server={server}
              onRetry={() => void person.run('enabled', MCP_COMMANDS.setEnabled, { enabled: true })}
            />
          </div>
        </PageSection>
        {/* Off, there is nothing to connect to: the form waits until the switch is on (UX1, M7). */}
        {enabled ? (
          <PageSection
            title={<Trans>Connect an agent</Trans>}
            icon={SETTINGS_ICONS.connection}
            description={
              <Trans>Taalcut copies the setup for you. Paste it where your agent asks for MCP servers.</Trans>
            }
          >
            <ConnectAgent />
          </PageSection>
        ) : null}
        {enabled || sessions.length > 0 ? (
          <ConnectedAgents sessions={sessions} highlight={highlight} />
        ) : null}
      </div>
    </Skeleton>
  );
}

/** The sessions, newest first, with what to do about a leaked key and which setup suits which Mac. */
function ConnectedAgents({
  sessions,
  highlight,
}: {
  sessions: McpState['sessions'];
  highlight: McpSessionId | undefined;
}) {
  const { t } = useLingui();
  const ordered = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <PageSection
      title={<Trans>Connected agents</Trans>}
      icon={SETTINGS_ICONS.connected}
      description={
        ordered.length === 0 ? undefined : (
          <>
            {/* Security review SB-33 (a leaked key) and SB-34 (the HTTP setup and other accounts). */}
            <Trans>
              If a key may have leaked, Revoke access stops it at once, or New key replaces it.
            </Trans>{' '}
            <Trans>
              Copy HTTP setup suits a Mac with one user account: while Taalcut is closed, another account on
              this Mac could answer in its place and collect the key.
            </Trans>
          </>
        )
      }
    >
      {ordered.length === 0 ? (
        <EmptyState variant="compact" icon={SETTINGS_ICONS.externalAgents} title={<Trans>No agents yet.</Trans>} />
      ) : (
        <ul aria-label={t`Connected agents`} className="m-0 flex list-none flex-col p-0">
          {ordered.map((session) => (
            <SessionRow key={session.id} session={session} highlighted={session.id === highlight} />
          ))}
        </ul>
      )}
    </PageSection>
  );
}
