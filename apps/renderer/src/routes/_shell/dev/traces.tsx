// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { RunId } from '@taalcut/core';
import { createFileRoute } from '@tanstack/react-router';
import { TracesPage } from '../../../features/traces/traces-page';
import { searchId } from '../../../shell/route-id';

export const Route = createFileRoute('/_shell/dev/traces')({
  // ?run=<id> picks a run; without it (or with a bad id) the newest run shows.
  // Search parses in the entry chunk, so this checks the ULID without core's runtime.
  // The router spreads the raw search under this result, so a bad run is set to undefined, not left out.
  validateSearch: (search: Record<string, unknown>): { run?: RunId | undefined } => ({
    run: searchId<'AgentRun'>(search.run),
  }),
  component: Traces,
});

function Traces() {
  const { run } = Route.useSearch();
  return <TracesPage runId={run} />;
}
