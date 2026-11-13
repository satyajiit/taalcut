// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.acknowledgements: the warning cards' "I understand" (PRD 10.1),
 * kept by the library's AcknowledgementStore in the agent process, so the
 * renderer's warning cards and the tools that check them read the same
 * record. Since REF1 (2026-10-29) no card stands before a reel link and
 * nothing checks REFERENCE_DOWNLOAD_WARNING.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import type { AcknowledgementStore } from '../ports/preferences';

/**
 * PRD 10.1: the warning before the first link download, once shared by the renderer and templates.fetchReference.
 *
 * @deprecated REF1: the owner removed the card on 2026-10-29. Reel links are fetched without asking, and nothing
 * records or checks this any more. It stays so acknowledgement stores that hold it still read.
 */
export const REFERENCE_DOWNLOAD_WARNING = {
  featureId: 'reference.download',
  termsVersion: '2026-10-01',
} as const;

/** The alpha terms a tester agrees to by continuing past onboarding's alpha step (P2-X4); the date is the version. */
export const ALPHA_TERMS = { featureId: 'alpha.terms', termsVersion: '2026-10-13' } as const;

/**
 * The public beta terms (P3-B14; counsel's text, in en, hi, es and pt-BR). 'draft' until counsel approves; the
 * version then becomes the text's date, so a draft acknowledgement stops counting.
 */
export const BETA_TERMS = { featureId: 'beta.terms', termsVersion: 'draft' } as const;

/**
 * LNX1-TRM: a component whose owner licenses it to the person under terms they accept in the app before it downloads
 * (the components manifest's `licence.acceptance`: NVIDIA's CUDA runtime and cuDNN). Their acceptance is an
 * acknowledgement under this featureId and the manifest's `termsVersion`; the jobs process's download and installs
 * read it from the same store, so a new terms version asks again.
 */
export const COMPONENT_TERMS_FEATURE_PREFIX = 'component.terms:';

/** The featureId a component's terms are accepted under, e.g. 'component.terms:cuda-runtime-13'. */
export function componentTermsFeatureId(componentId: string): string {
  return `${COMPONENT_TERMS_FEATURE_PREFIX}${componentId}`;
}

const ack = { featureId: z.string().min(1).max(100), termsVersion: z.string().min(1).max(100) };

export const acknowledgementsContract = {
  has: ipc.input(z.object(ack)).output(z.boolean()),
  /** Records the pair; recording it again keeps (and answers) the first time. */
  record: ipc
    .input(z.object({ ...ack, context: z.record(z.string(), z.string().max(2048)).optional() }))
    .output(z.object({ acknowledgedAt: z.int().nonnegative() })),
};

export function acknowledgementsRouter(store: Pick<AcknowledgementStore, 'has' | 'record'>) {
  const os = implementContract(acknowledgementsContract);
  return os.router({
    has: os.has.handler(async ({ input }) => unwrapRpc(await store.has(input.featureId, input.termsVersion))),
    record: os.record.handler(async ({ input }) => {
      const recorded = unwrapRpc(
        await store.record({
          featureId: input.featureId,
          termsVersion: input.termsVersion,
          ...(input.context ? { context: input.context } : {}),
        }),
      );
      return { acknowledgedAt: recorded.acknowledgedAt };
    }),
  });
}
