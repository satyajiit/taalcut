// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  styleSourceKey,
  type StyleProfileView,
  type StyleSource,
  type TaalcutError,
} from '@taalcut/core';
import { useEffect, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery, type Reloadable } from '../../../backend/use-rpc';

export interface StyleProfileState {
  readonly state: Reloadable<StyleProfileView>;
  /** templates.writeStyleSummary is on its way. */
  readonly asking: boolean;
  /** It failed (the summary's own failure is in the view). */
  readonly askFailure: TaalcutError | null;
  readonly writeAgain: () => void;
}

/**
 * A set's style profile (LRN1-STY), read again when the service announces it (`library.changed`, entity
 * 'styleProfile' with the set's key) or a template changes (a reel linked, a template filed or tagged), and the
 * way to ask for its summary again.
 */
export function useStyleProfile(source: StyleSource): StyleProfileState {
  const backend = useBackend();
  const key = styleSourceKey(source);
  const state = useRpcQuery(
    (signal) => backend.templates.styleProfile({ source }, { signal }),
    [backend, key],
  );
  const [asking, setAsking] = useState(false);
  const [askFailure, setAskFailure] = useState<TaalcutError | null>(null);
  const { reload } = state;

  useEffect(() => setAskFailure(null), [key]);

  useBackendEvents(['library.changed'], (event) => {
    const { entity, ids } = event.payload;
    if ((entity === 'styleProfile' && ids.includes(key)) || entity === 'template') reload();
  });

  const writeAgain = () => {
    setAsking(true);
    setAskFailure(null);
    void callRpc(backend.templates.writeStyleSummary({ source })).then((answer) => {
      setAsking(false);
      if (answer.ok) reload();
      else setAskFailure(answer.error);
    });
  };

  return { state, asking, askFailure, writeAgain };
}
