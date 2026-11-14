// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One structured line in the Worker's logs. Ids, modes and counts only: never a name, an address or a key. */
export function logInfo(event: string, fields: Readonly<Record<string, string | number>> = {}): void {
  // eslint-disable-next-line no-console -- the platform's logs read console.log as the "info" level; an order being made or paid is not a warning
  console.log(JSON.stringify({ event, ...fields }));
}
