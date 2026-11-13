// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Battery and thermal state, from main to the jobs process. Electron's
 * powerMonitor exists only in main, so main sends a snapshot when the jobs
 * process connects and after every change; the job engine throttles on it.
 * Not part of the app contract: the renderer can't set it.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { implementContract, ipc } from './contract';

export const THERMAL_STATES = ['nominal', 'fair', 'serious', 'critical'] as const;
export type ThermalState = (typeof THERMAL_STATES)[number];

export const powerSnapshotSchema = z.object({
  onBattery: z.boolean(),
  thermalState: z.enum(THERMAL_STATES),
});
export type PowerSnapshot = z.infer<typeof powerSnapshotSchema>;

export const powerContract = {
  /** The current snapshot; replaces the previous one. */
  update: ipc.input(powerSnapshotSchema).output(z.object({ applied: z.literal(true) })),
};

/** The jobs process's side: hands each snapshot to `apply`. */
export function powerRouter(apply: (snapshot: PowerSnapshot) => void) {
  const os = implementContract(powerContract);
  return os.router({
    update: os.update.handler(({ input }) => {
      apply(input);
      return { applied: true as const };
    }),
  });
}
