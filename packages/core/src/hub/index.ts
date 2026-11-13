// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/core/hub: the small entry services/hub-worker (a Cloudflare Worker) bundles. Only the hub template's
 * schema, its content rules, the index, the Worker's request and response bodies and the error codes as data,
 * with the template parts, style fields and time types they reuse: no IPC, no commands, no DI, no ports, about
 * 100 KB gzipped. Zod runs with its JIT off (basics/zod-config), which Workers need (no `new Function`).
 * Everything here is also exported from '@taalcut/core'.
 */
export * from './hub-parts';
export * from './hub-template';
export * from './content-rules';
export * from './hub-index';
export * from './worker-api';
export * from './hub-error-codes';
