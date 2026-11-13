// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An external agent's call waiting for the person (P3-V4): when the agent asks for an approval in an MCP session's
 * run (`agent.approvalRequested` whose run is a session's) and no Taalcut window is focused, main posts a system
 * notification naming the session; a click brings the app forward on the agent area, where the card is. The
 * built-in agent's approvals stay in the window as before. Electron is injected (approval-notify-electron.ts).
 */
import type { I18n } from '@lingui/core';
import type { AsyncResult, EventBus, RunId } from '@taalcut/core';
import { MCP_APPROVAL_MESSAGES } from '../i18n/mcp-messages';
import type { NotificationLike } from '../render/render-notify';

/** Electron's part: the Notification, main's locale, the windows. */
export interface McpNotifier {
  readonly i18n: Pick<I18n, '_'>;
  /** Notification.isSupported(). */
  readonly isSupported: () => boolean;
  readonly create: (options: { readonly title: string; readonly body: string }) => NotificationLike;
  /** Whether a Taalcut window has focus now (then the card is in front of the person already). */
  readonly windowFocused: () => boolean;
  /** Shows the app on the agent area. */
  readonly open: () => void;
}

export interface McpApprovalNotifyDeps extends McpNotifier {
  readonly events: Pick<EventBus, 'on'>;
  /** The MCP session whose external run this is; undefined for the built-in agent's runs. */
  readonly sessionOf: (runId: RunId) => AsyncResult<{ readonly name: string } | undefined>;
  readonly log?: (message: string) => void;
}

/** Starts listening; returns the unsubscribe. */
export function startMcpApprovalNotifications(deps: McpApprovalNotifyDeps): () => void {
  const log = deps.log ?? ((message: string) => console.warn(message));
  // Electron drops a notification's click handler if the object is collected, so keep each until it closes.
  const live = new Set<NotificationLike>();
  const post = (name: string): void => {
    const notification = deps.create({
      title: deps.i18n._({ ...MCP_APPROVAL_MESSAGES.title, values: { name } }),
      body: deps.i18n._(MCP_APPROVAL_MESSAGES.body),
    });
    live.add(notification);
    notification.on('click', () => {
      live.delete(notification);
      deps.open();
    });
    notification.on('close', () => live.delete(notification));
    notification.show();
  };
  return deps.events.on('agent.approvalRequested', ({ payload }) => {
    if (!deps.isSupported() || deps.windowFocused()) return;
    void deps.sessionOf(payload.runId).then((session) => {
      if (!session.ok) return log(`[mcp] approval notification skipped: ${session.error.code}`);
      // Focus may have come back while the session was looked up.
      if (session.value && !deps.windowFocused()) post(session.value.name);
    });
  });
}
