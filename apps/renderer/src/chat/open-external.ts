// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { callRpc, err, isExternalLink, ValidationError, type AsyncResult } from '@taalcut/core';
import { errorMessage, toast } from '@taalcut/ui';
import { useCallback } from 'react';
import { useBackend, type Backend } from '../backend/backend';

/**
 * G8 (round P3-3): a provider's page (billing, usage, keys), the beta terms, in the person's browser. A window
 * can't open a new window (desktop refuses every one), so it asks main through `files.openExternal`, which opens
 * only https pages on core's list (`isExternalLink`). A page off the list is refused here as main would refuse it.
 */
export function openExternalWith(backend: Backend): (url: string) => AsyncResult<void> {
  return async (url) =>
    isExternalLink(url)
      ? callRpc(backend.files.openExternal({ url }))
      : err(ValidationError({ field: 'url' }));
}

/** Opens a page in the browser; a refusal or a failed call is a toast that says why. */
export function useOpenExternal(): (url: string) => void {
  const backend = useBackend();
  const { i18n, t } = useLingui();
  return useCallback(
    (url: string) => {
      void openExternalWith(backend)(url).then((opened) => {
        if (!opened.ok)
          toast({
            tone: 'danger',
            title: t`Couldn’t open that page`,
            description: errorMessage(i18n, opened.error),
          });
      });
    },
    [backend, i18n, t],
  );
}
