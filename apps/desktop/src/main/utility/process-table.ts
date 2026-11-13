// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The utility processes of PRD 6.1. This round every one of them runs the
 * stub entry; each gets its real entry as its work package lands.
 */
import { type ProcessSpec } from './supervisor';

export const UTILITY_PROCESSES = ['agent', 'jobs', 'render', 'lan', 'mcp'] as const;
export type UtilityProcessName = (typeof UTILITY_PROCESSES)[number];

export interface UtilityProcessSpec extends ProcessSpec {
  readonly name: UtilityProcessName;
  /**
   * Started with the app. render and LAN start on demand (the LAN server only while the QR screen is open); mcp
   * only while External agents is on (main/mcp/mcp-lifecycle.ts, D18).
   */
  readonly eager: boolean;
}

export function utilityProcessTable(stubEntry: string): readonly UtilityProcessSpec[] {
  return [
    { name: 'agent', modulePath: stubEntry, serviceName: 'Taalcut agent', eager: true },
    { name: 'jobs', modulePath: stubEntry, serviceName: 'Taalcut jobs', eager: true },
    { name: 'render', modulePath: stubEntry, serviceName: 'Taalcut render', eager: false },
    { name: 'lan', modulePath: stubEntry, serviceName: 'Taalcut LAN', eager: false },
    { name: 'mcp', modulePath: stubEntry, serviceName: 'Taalcut external agents', eager: false },
  ];
}
