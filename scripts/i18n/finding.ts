// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export interface Finding {
  file: string;
  line: number;
  id: string;
  message: string;
}

export function formatFinding(finding: Finding): string {
  const id = finding.id === '' ? '' : `${finding.id}: `;
  return `${finding.file}:${finding.line}: ${id}${finding.message}`;
}
