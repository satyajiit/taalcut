// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one selection of what runs here (UX2-DOWNLOADER, LNX1 seam 4, LNX1-TRM): the tier's picks, each as the member
 * of its variant group that has a build here, fits the machine and whose owner's terms (and its dependencies') are
 * accepted, with their dependencies. The download of everything this machine needs fetches it (`planSet`), and an
 * install that asks for "the build that runs here" (the local runtime's llama.cpp) takes the same member
 * (`variantHere`), so the two never disagree.
 *
 * `planSet` also says what waits on terms: each component whose terms aren't accepted that the set would fetch
 * once they are, with the components it would bring in (the CUDA builds). Pure.
 */
import { err, ok, type Result } from '@taalcut/core';
import { ComponentUnknown } from '../errors';
import type { ComponentEntry, ComponentManifest } from '../manifest';
import { chooseVariant, findComponent, tierPicks } from '../selection';
import { termsHolds } from '../terms';
import { misfit, type MachineFit } from './choices';
import { dependenciesOf, neededComponents } from './order';

export interface SelectionInput {
  readonly manifest: ComponentManifest;
  readonly platform: string;
  readonly fit: MachineFit;
  /** The components whose owner's terms the person hasn't accepted (terms.ts unacceptedTerms). */
  readonly unaccepted: ReadonlySet<string>;
}

/** A component held out of the set until its owner's terms are accepted, and what it would bring in. */
export interface HeldBack {
  readonly component: ComponentEntry;
  readonly unlocks: readonly string[];
}

export interface SetPlan {
  /** What the set fetches here, dependencies first. */
  readonly needed: readonly ComponentEntry[];
  readonly held: readonly HeldBack[];
}

/** Whether a component is fetched here: misfit's every rule, the terms included. */
function fetchedHere({ manifest, platform, fit, unaccepted }: SelectionInput) {
  const terms = termsHolds(manifest, unaccepted);
  return (component: ComponentEntry) => misfit(component, platform, fit, terms) === undefined;
}

function neededWith(input: SelectionInput): Result<ComponentEntry[]> {
  const { manifest, platform, fit } = input;
  const wanted = tierPicks(manifest, fit.tier, platform, fetchedHere(input)).map((c) => c.id);
  return neededComponents(manifest, wanted, platform);
}

/** What the set fetches, and what it would fetch once the terms that hold components back are accepted. */
export function planSet(input: SelectionInput): Result<SetPlan> {
  const needed = neededWith(input);
  if (!needed.ok || input.unaccepted.size === 0)
    return needed.ok ? ok({ needed: needed.value, held: [] }) : needed;
  const open = neededWith({ ...input, unaccepted: new Set() });
  if (!open.ok) return ok({ needed: needed.value, held: [] });
  const inSet = new Set(needed.value.map((c) => c.id));
  const extra = open.value.filter((c) => !inSet.has(c.id));
  const held = extra
    .filter((c) => input.unaccepted.has(c.id))
    .map((component) => ({
      component,
      unlocks: extra
        .filter((other) => dependenciesOf(input.manifest, other.id).includes(component.id))
        .map((other) => other.id),
    }));
  return ok({ needed: needed.value, held });
}

/**
 * The member of `id`'s variant group the set takes here: its most preferred build that has an artifact, fits and
 * whose terms are accepted; `id` itself when none does (its install then says why). Unknown id: an error.
 */
export function variantHere(input: SelectionInput, id: string): Result<ComponentEntry> {
  const base = findComponent(input.manifest, id);
  if (!base) return err(ComponentUnknown({ component: id }));
  return ok(chooseVariant(input.manifest, base, input.platform, fetchedHere(input)) ?? base);
}
