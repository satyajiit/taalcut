// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type GateReport } from './build';

export function renderJson(report: GateReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
