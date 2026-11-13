// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Install identity for telemetry (P2-X7). Core has no setting for it: a new
 * id and HMAC salt each time telemetry is turned on, forgotten when it is
 * turned off. The salt never leaves the Mac; a project id is hashed with it.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { defineSetting, idSchema, newId, type InstallId, type SettingsStore } from '@taalcut/core';
import { z } from 'zod';

export const TELEMETRY_INSTALL_SETTING = defineSetting(
  'telemetry.install',
  z
    .object({
      installId: idSchema<'Install'>(),
      /** 32 random bytes, hex. The HMAC key; not an event field. */
      salt: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .nullable(),
  null,
);

export interface TelemetryInstall {
  readonly installId: InstallId;
  readonly salt: string;
}

/** First 16 hex chars of HMAC-SHA-256(salt bytes, projectId). */
export function telemetryProjectKey(saltHex: string, projectId: string): string {
  return createHmac('sha256', Buffer.from(saltHex, 'hex')).update(projectId).digest('hex').slice(0, 16);
}

/** The stored install, or a new one. Undefined when the settings write does not land. */
export async function ensureTelemetryInstall(settings: SettingsStore): Promise<TelemetryInstall | undefined> {
  const current = await settings.get(TELEMETRY_INSTALL_SETTING);
  if (!current.ok) return undefined;
  if (current.value) return current.value;
  const created = { installId: newId<'Install'>(), salt: randomBytes(32).toString('hex') };
  const written = await settings.set(TELEMETRY_INSTALL_SETTING, created);
  if (!written.ok || written.value === null) return undefined;
  return written.value;
}

/** Drops the install id and salt. The outbox is cleared by the service alongside this. */
export async function forgetTelemetryInstall(settings: SettingsStore): Promise<void> {
  const reset = await settings.reset(TELEMETRY_INSTALL_SETTING);
  if (!reset.ok) console.warn(`[telemetry] install id not cleared: ${reset.error.code}`);
}
