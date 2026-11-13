// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Accepting a component owner's terms (LNX1-TRM: NVIDIA's for its CUDA libraries, `cuda-runtime-13`). The window
 * records the person's acceptance in the library's acknowledgements, under the component's own featureId and the
 * manifest's terms version, with what they accepted as its context; then it starts the download, which re-plans and
 * brings the CUDA runtime and the builds that load it in (the jobs process reads the same acknowledgements). "Not
 * now" holds the card back for this window's session; Settings › Models still offers it.
 */
import {
  callRpc,
  componentTermsFeatureId,
  type Component,
  type ComponentTerms,
  type TaalcutError,
} from '@taalcut/core';
import { useCallback, useState } from 'react';
import { useBackend } from '../../backend/backend';
import type { Backend } from '../../backend/contract';
import { useDownloadActions } from '../downloads/use-download-actions';

/** Whose libraries the NVIDIA card is about (the manifest's `licence.acceptance.owner`). */
export const NVIDIA_OWNER = 'NVIDIA Corporation';
export const CUDA_RUNTIME = 'cuda-runtime-13';

/** The name an owner goes by in a sentence: "NVIDIA" for "NVIDIA Corporation". Product names: never translated. */
export function ownerBrand(owner: string): string {
  return owner.replace(/,?\s+(?:Corporation|Corp\.?|Inc\.?|Ltd\.?|LLC|GmbH)$/i, '') || owner;
}

/** A component with terms, whatever its state. */
export type TermsComponent = Component & { readonly terms: ComponentTerms };
export const hasTerms = (component: Component): component is TermsComponent => component.terms !== undefined;

/** What the acknowledgement keeps: which component and version, whose terms, and the texts accepted. */
export function termsContext(component: TermsComponent): Record<string, string> {
  return {
    component: component.id,
    version: component.version,
    owner: component.terms.owner,
    documents: component.terms.documents.map((document) => document.url).join(' '),
  };
}

export interface AcceptTerms {
  /** The component whose acceptance is on its way, or recorded and waiting for the download to re-plan. */
  readonly accepting: string | null;
  readonly error: TaalcutError | null;
  accept(component: TermsComponent): void;
}

/** Records the acceptance, then starts the download, which now takes the component and what it unlocks. */
export function useAcceptTerms(): AcceptTerms {
  const backend = useBackend();
  const { start } = useDownloadActions();
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const accept = useCallback(
    (component: TermsComponent) => {
      setError(null);
      setAccepting(component.id);
      void callRpc(
        backend.acknowledgements.record({
          featureId: componentTermsFeatureId(component.id),
          termsVersion: component.terms.termsVersion,
          context: termsContext(component),
        }),
      ).then((recorded) => {
        if (!recorded.ok) {
          setAccepting(null);
          setError(recorded.error);
          return;
        }
        // The card goes once the download no longer waits on these terms; until then it stays busy.
        start();
      });
    },
    [backend, start],
  );
  return { accepting, error, accept };
}

/** "Not now", for this window's session: first run's card doesn't come back on its own. */
const declined = new WeakMap<Backend, Set<string>>();

export function useDeclined(id: string): [boolean, () => void] {
  const backend = useBackend();
  const [, rerender] = useState(0);
  const set = declined.get(backend) ?? new Set<string>();
  const decline = useCallback(() => {
    const kept = declined.get(backend) ?? new Set<string>();
    kept.add(id);
    declined.set(backend, kept);
    rerender((n) => n + 1);
  }, [backend, id]);
  return [set.has(id), decline];
}
