// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.consents: the standing upload consents ("Always allow" on a
 * consent card, PRD G9), served by the agent process, which asks for them
 * and keeps them. `list` shows what may leave the Mac without asking; `revoke`
 * takes one back, so the module's next upload asks again. Revoking is not a
 * command on the bus: ⌘Z must never give consent back. For the Settings
 * control (privacy) the Hallmark redesign builds.
 */
import '../basics/zod-config';
import { z } from 'zod';
import type { AsyncResult } from '../basics/result';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';

/** A cloud module that sends the user's media out, e.g. 'vision'. */
const consentModuleSchema = z.string().min(1).max(64);

export const uploadConsentSchema = z.object({
  module: consentModuleSchema,
  /** The providers the user allowed (the ones the consent card named). A provider added later asks again. */
  providers: z.array(z.string().min(1)),
  /** Epoch ms. */
  grantedAt: z.int().nonnegative(),
});
export type UploadConsentInfo = z.infer<typeof uploadConsentSchema>;

export const consentRevokedSchema = z.object({
  module: consentModuleSchema,
  /** False when there was nothing to take back: revoking twice is fine. */
  revoked: z.boolean(),
});
export type ConsentRevoked = z.infer<typeof consentRevokedSchema>;

export const consentsContract = {
  /** Every standing consent, by module name. */
  list: ipc.output(z.array(uploadConsentSchema)),
  /** Idempotent. The next upload for the module asks again, also in a run already going. */
  revoke: ipc.input(z.object({ module: consentModuleSchema })).output(consentRevokedSchema),
};

/** What the agent process serves appContract.consents from (@taalcut/agent's consentsService). */
export interface ConsentsService {
  list(): AsyncResult<UploadConsentInfo[]>;
  revoke(input: { readonly module: string }): AsyncResult<ConsentRevoked>;
}

export function consentsRouter(service: ConsentsService) {
  const os = implementContract(consentsContract);
  return os.router({
    list: os.list.handler(async () => unwrapRpc(await service.list())),
    revoke: os.revoke.handler(async ({ input }) => unwrapRpc(await service.revoke(input))),
  });
}
