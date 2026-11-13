// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gate for a component whose owner licenses it to the person under terms they accept in the app (LNX1-TRM: the
 * manifest's `licence.acceptance`, NVIDIA's for cuda-runtime-13). The acceptance is an acknowledgement in core's
 * AcknowledgementStore (the library's: the window records it through appContract.acknowledgements) under
 * `component.terms:<id>` and the manifest's termsVersion, so a new version asks again.
 *
 * It fails closed: no store, a store that can't answer, or an acceptance of another version counts as not accepted.
 * Such a component, and everything that depends on it, stays out of the download like a component that doesn't fit
 * the machine (its variant group falls back to the next build), and an install of it is refused.
 */
import { componentTermsFeatureId, type AcknowledgementStore, type TaalcutError } from '@taalcut/core';
import { TermsNotAccepted } from './errors';
import type { ComponentEntry, ComponentManifest } from './manifest';

/** Where acceptances are read: the AcknowledgementStore's `has`. */
export type TermsBook = Pick<AcknowledgementStore, 'has'>;

/** The component whose owner's terms hold another back (itself, or one it depends on at any depth). */
export interface TermsHold {
  readonly component: string;
  readonly owner: string;
}

/** For the log and an error's detail: "NVIDIA Corporation's terms not accepted (cuda-runtime-13)". */
export const termsReason = (hold: TermsHold): string =>
  `${hold.owner}'s terms not accepted (${hold.component})`;

/** The ids of `components` whose owner's terms the person hasn't accepted. */
export async function unacceptedTerms(
  components: readonly Pick<ComponentEntry, 'id' | 'licence'>[],
  book: TermsBook | undefined,
  log?: (message: string) => void,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const { id, licence } of components) {
    const acceptance = licence.acceptance;
    if (!acceptance) continue;
    const accepted = await readAcceptance(book, id, acceptance.termsVersion);
    if (accepted === undefined) log?.(`[components] ${id}: its terms can't be read; treated as not accepted`);
    if (accepted !== true) out.add(id);
  }
  return out;
}

/** Whether the store holds this exact acceptance; undefined when it can't say (no store, an error). */
async function readAcceptance(
  book: TermsBook | undefined,
  id: string,
  termsVersion: string,
): Promise<boolean | undefined> {
  if (!book) return undefined;
  try {
    const has = await book.has(componentTermsFeatureId(id), termsVersion);
    return has.ok ? has.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which terms hold each component back, given the components whose terms aren't accepted: its own, else the first
 * dependency's (depth first, in the manifest's order). Undefined: nothing holds it.
 */
export function termsHolds(
  manifest: ComponentManifest,
  unaccepted: ReadonlySet<string>,
): (id: string) => TermsHold | undefined {
  const byId = new Map(manifest.components.map((c) => [c.id, c]));
  const memo = new Map<string, TermsHold | undefined>();
  // The manifest schema rejects dependency cycles, so the recursion ends.
  const holdOf = (id: string): TermsHold | undefined => {
    if (memo.has(id)) return memo.get(id);
    const component = byId.get(id);
    const owner = component?.licence.acceptance?.owner;
    const own = owner !== undefined && unaccepted.has(id) ? { component: id, owner } : undefined;
    const hold = own ?? component?.dependencies.map(holdOf).find((each) => each !== undefined);
    memo.set(id, hold);
    return hold;
  };
  return unaccepted.size === 0 ? () => undefined : holdOf;
}

/**
 * The refusal to install `order` (a component and everything it depends on) while the terms of one in it aren't
 * accepted, or undefined when there is none to accept or all are. The manager returns it without keeping it as the
 * component's last failure: nothing was tried.
 */
export async function refuseUnaccepted(
  order: readonly ComponentEntry[],
  book: TermsBook | undefined,
  log?: (message: string) => void,
): Promise<TaalcutError | undefined> {
  const unaccepted = await unacceptedTerms(order, book, log);
  const held = order.find((component) => unaccepted.has(component.id));
  const owner = held?.licence.acceptance?.owner;
  if (!held || owner === undefined) return undefined;
  const hold = { component: held.id, owner };
  return TermsNotAccepted(hold, { detail: termsReason(hold) });
}
