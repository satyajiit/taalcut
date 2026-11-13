// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two update events main records (P3-B9, core LAUNCH_TELEMETRY_EVENTS): update.installed on the first
 * healthy launch of a new version, update.rolledBack when the guard had to put the old one back. Facts the
 * catalogue rejects (a version it can't read, a team channel it doesn't know) are not recorded. The agent's
 * telemetry service checks consent, Local only and the endpoint; nothing here can make an event leave the Mac.
 */
import { telemetryEventSchema, type Telemetry, type UpdateChannel } from '@taalcut/core';
import { rollbackTelemetryReason } from './rollback-notice';
import type { PendingUpdate, RolledBack } from './update-files';

export function recordUpdateInstalled(
  telemetry: Telemetry,
  pending: PendingUpdate,
  fallbackChannel: UpdateChannel | null,
): void {
  const channel = pending.channel ?? fallbackChannel;
  if (!channel) return;
  const parsed = telemetryEventSchema.safeParse({
    name: 'update.installed',
    from: pending.from,
    to: pending.to,
    channel,
    delta: pending.delta ?? false,
  });
  if (parsed.success) telemetry.record(parsed.data);
}

export function recordUpdateRolledBack(telemetry: Telemetry, rollback: RolledBack): void {
  const parsed = telemetryEventSchema.safeParse({
    name: 'update.rolledBack',
    from: rollback.from,
    to: rollback.to,
    reason: rollbackTelemetryReason(rollback.reason),
  });
  if (parsed.success) telemetry.record(parsed.data);
}
