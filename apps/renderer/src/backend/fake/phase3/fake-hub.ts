// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B12, P3-V8: the template hub as @taalcut/templates' hub client answers it (appContract.hub) over a cached
 * index of 40 templates, and its commands (hub.publish, hub.fork, hub.rate, hub.report, hub.openShare), refused
 * as the real ones are: not configured in this build, Local only, offline with a cached index, rate limits.
 * fake-phase3.ts serves `router` as the `hub` namespace. The parts are in ./hub.
 */
import { appContract, implementContract, unwrapRpc, type AnyCommand } from '@taalcut/core';
import type { Phase3Deps } from './phase3-deps';
import { hubCommands } from './hub/hub-commands';
import { hubBrowse, hubGet, hubShareCheck, hubStatus, hubSubmissions } from './hub/hub-reads';
import { createHubState, type FakeHubOptions } from './hub/hub-state';

export type { FakeHubOptions } from './hub/hub-state';

export function createFakeHub(deps: Phase3Deps, options: FakeHubOptions = {}) {
  const state = createHubState(deps.now(), options);
  const os = implementContract(appContract.hub);
  const router = os.router({
    status: os.status.handler(() => hubStatus(state, deps, options)),
    browse: os.browse.handler(async ({ input }) => unwrapRpc(await hubBrowse(state, deps, options, input))),
    get: os.get.handler(async ({ input }) => unwrapRpc(await hubGet(state, deps, options, input.hubId))),
    shareCheck: os.shareCheck.handler(async ({ input }) =>
      unwrapRpc(await hubShareCheck(state, deps, input)),
    ),
    submissions: os.submissions.handler(async ({ input }) =>
      unwrapRpc(await hubSubmissions(state, deps, options, input)),
    ),
  });
  const commands: AnyCommand[] = hubCommands(deps, state, options);
  return { router, commands, state };
}

export type FakeHub = ReturnType<typeof createFakeHub>;
