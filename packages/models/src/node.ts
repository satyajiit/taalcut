// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * '@taalcut/models/node': Node adapters for the ports the local runtime
 * needs. Kept out of the main entry so nothing that bundles '@taalcut/models'
 * pulls in child_process. The desktop main process wires them:
 *
 *   createLlamaServerDriver({ spawn: createNodeSpawnPort(), freePort: findFreeLoopbackPort })
 */
export { findFreeLoopbackPort } from './node/free-port';
export { createNodeSpawnPort, type NodeSpawnPort } from './node/spawn';
/*
 * P3-B10: the network recorder, a Node adapter too (it wraps net, tls, http(s), dns, dgram, fetch and
 * WebSocket in the process it runs in). Tests take it from test-support; the desktop's test-build hooks take
 * it from here, inside `__TAALCUT_FLAVOUR__ === 'test'` only, since test-support is for tests alone.
 */
export { recordNetwork, type NetworkAttempt, type NetworkRecorder } from './testing/network-recorder';
export { isLoopbackHost } from './testing/network-targets';
