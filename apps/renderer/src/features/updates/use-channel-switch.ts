// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * About › Updates' channel switch (P3-B9): `updates.setChannel` from the person, undoable. Beta needs the beta
 * terms first: when they aren't recorded (here, or as the handler's own `desktop.beta_terms_required`) the terms
 * open under Beta, and agreeing records them before the switch. Stable needs nothing.
 */
import { useLingui } from '@lingui/react/macro';
import {
  BETA_TERMS,
  UPDATE_COMMANDS,
  type PublicUpdateChannel,
  type TaalcutError,
  type UpdateState,
} from '@taalcut/core';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useCommand } from '../../backend/use-command';
import { useRpcQuery } from '../../backend/use-rpc';
import { agreeToBetaTerms } from '../terms/beta-terms';

export function useChannelSwitch(state: UpdateState) {
  const { t } = useLingui();
  const backend = useBackend();
  const command = useCommand({ toast: false });
  const agreed = useRpcQuery(
    (signal) =>
      backend.acknowledgements.has(
        { featureId: BETA_TERMS.featureId, termsVersion: BETA_TERMS.termsVersion },
        { signal },
      ),
    [backend],
  );
  const [askingTerms, setAskingTerms] = useState(false);
  const [pending, setPending] = useState<PublicUpdateChannel | null>(null);
  const [failed, setFailed] = useState<TaalcutError | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // A public build's channel (team builds show theirs as a fact and never switch).
  const current: PublicUpdateChannel = state.choice ?? (state.channel === 'beta' ? 'beta' : 'stable');

  const switchTo = async (channel: PublicUpdateChannel) => {
    setFailed(null);
    setPending(channel);
    const result = await command.run({
      name: UPDATE_COMMANDS.setChannel,
      payload: { projectId: null, channel },
    });
    setPending(null);
    if (result.ok) {
      setAskingTerms(false);
      setAnnouncement(channel === 'beta' ? t`You’ll get beta updates.` : t`You’ll get stable updates.`);
      return;
    }
    // The handler checks the beta terms itself: if they weren't recorded, ask for them here.
    if (result.error.code === 'desktop.beta_terms_required') setAskingTerms(true);
    else setFailed(result.error);
  };

  return {
    current,
    /** The radio that shows as chosen: Beta while its terms are open. */
    shown: askingTerms ? 'beta' : current,
    askingTerms,
    pending,
    failed,
    announcement,
    choose(channel: PublicUpdateChannel) {
      setAnnouncement('');
      if (channel === current) return setAskingTerms(false);
      if (channel === 'beta' && agreed.data !== true) return setAskingTerms(true);
      void switchTo(channel);
    },
    async agree() {
      setFailed(null);
      setPending('beta');
      const recorded = await agreeToBetaTerms(backend);
      if (!recorded.ok) {
        setPending(null);
        return setFailed(recorded.error);
      }
      agreed.reload();
      await switchTo('beta');
    },
    cancelTerms() {
      setAskingTerms(false);
      setFailed(null);
    },
  };
}
