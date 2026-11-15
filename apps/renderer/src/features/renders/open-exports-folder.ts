// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Opens the person's exports folder in Finder (FIX-EXPORTNAMES; the owner, 2026-11-15: "theirs no feature to
 * access or locate the exported video. Add option to open the exported folder"): the one folder every finished
 * video, cover and pro export lands in, under its own name. Main opens it (files.openExportsFolder) and makes it
 * first if nothing was exported yet; a refusal says its cause in a toast. Used by Exports and by the editor's More
 * menu, so the folder is one press away from where a video is made and from where the exports are listed.
 */
import { useLingui } from '@lingui/react/macro';
import { callRpc } from '@taalcut/core';
import { errorMessage, toast } from '@taalcut/ui';
import { useCallback } from 'react';
import { useBackend } from '../../backend/backend';

export function useOpenExportsFolder(): () => void {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  return useCallback(() => {
    void callRpc(backend.files.openExportsFolder()).then((result) => {
      if (!result.ok)
        toast({
          tone: 'danger',
          title: t`Couldn’t open the exports folder`,
          description: errorMessage(i18n, result.error),
        });
    });
  }, [backend, i18n, t]);
}
