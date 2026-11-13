// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Contract style: contract-first oRPC with zod. A contract is a plain object of
 * procedures built from `ipc`, so every procedure declares the TAALCUT error and
 * failures arrive typed. See packages/core/SPEC.md, "Typed IPC".
 *
 *   export const themeContract = {
 *     get: ipc.output(themeStateSchema),
 *     set: ipc.input(z.object({ preference: themePreferenceSchema })).output(themeStateSchema),
 *     changed: ipc.output(eventIterator(themeStateSchema)),
 *   };
 *
 * Core re-exports the few oRPC pieces packages need, so the oRPC version is
 * pinned in one place and no other package depends on oRPC directly.
 */
import { oc } from '@orpc/contract';
import { implement } from '@orpc/server';
import { RPC_ERRORS } from './errors';

export { eventIterator } from '@orpc/contract';
export type { AnyContractRouter, ContractRouterClient as RpcClient } from '@orpc/contract';
export type { Router as RpcRouter } from '@orpc/server';

/** The base builder for every procedure in a Taalcut contract. */
export const ipc = oc.errors(RPC_ERRORS);

/**
 * Starts the server side of a contract: `implementContract(c).x.handler(fn)` for
 * each procedure, then `.router({...})`. oRPC checks the handlers against the
 * contract at compile time.
 */
export const implementContract = implement;
