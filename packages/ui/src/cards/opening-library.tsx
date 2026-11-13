// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: opening choice, use my library (no sources yet) · genre: atmospheric studio app
 * system: DESIGN.md v0.3 · a line on what's missing, then Add folder (the panel's primary) and Connect phone
 * states: default · hover/focus/active (the Buttons') · disabled (a start in flight) · loading (Add folder spins
 *   through main's dialog, the command and the start) · error (the cause under the buttons) · success (the flow starts)
 */
import { Trans } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { useState } from 'react';
import { Button } from '#components/button';
import { useCardActions } from './card-actions';
import { ErrorLine } from './error-line';
import { VERB_ICONS } from '../icons/concepts';

export interface OpeningLibraryProps {
  disabled: boolean;
  /** The folder is in: start the library flow. */
  onAdded: () => Promise<TaalcutError | null>;
}

/** Nothing in the library yet: add a folder (then the flow starts), or connect the phone. */
export function OpeningLibrary({ disabled, onAdded }: OpeningLibraryProps) {
  const actions = useCardActions();
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState<TaalcutError | null>(null);

  const add = async () => {
    if (!actions.pickFolder || !actions.dispatch) return;
    setAdding(true);
    setFailed(null);
    const picked = await actions.pickFolder();
    if (!picked.ok || !picked.value) {
      setAdding(false);
      if (!picked.ok) setFailed(picked.error);
      return;
    }
    const added = await actions.dispatch('library.addSource', { path: picked.value.path });
    const error = added.ok ? await onAdded() : added.error;
    setAdding(false);
    setFailed(error);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="m-0 max-w-[56ch] text-sm text-ink-2">
        <Trans>
          Your library is empty. Add a folder of videos on this Mac, or send them from your phone over Wi-Fi.
        </Trans>
      </p>
      <div className="flex flex-wrap gap-2">
        {actions.pickFolder && actions.dispatch ? (
          <Button
            variant="primary"
            size="sm"
            icon={VERB_ICONS.addFolder}
            loading={adding}
            disabled={disabled}
            onClick={() => void add()}
          >
            <Trans>Add folder</Trans>
          </Button>
        ) : null}
        {actions.navigate ? (
          <Button size="sm" disabled={disabled || adding} onClick={() => actions.navigate?.({ to: 'phone' })}>
            <Trans>Connect phone</Trans>
          </Button>
        ) : null}
      </div>
      {failed ? <ErrorLine error={failed} /> : null}
    </div>
  );
}
