// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V14: "Export file…" on a template's page (the window bar's Share menu): main runs templates.exportDocument,
 * then the Save panel, for the version shown, as a .taalcut-template file (structure only, CC0-ready). The toast
 * names the file, or says why it couldn't be saved; Cancel in the panel says nothing.
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, type TemplateId } from '@taalcut/core';
import { toast, UserContent } from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { libraryErrorText } from './library-words';

export function useExportTemplateFile(templateId: TemplateId, version: number) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const result = await callRpc(backend.files.saveTemplateAs({ templateId, version, includeStyle: false }));
    setSaving(false);
    if (!result.ok) {
      toast({
        tone: 'danger',
        title: t`Couldn’t export the template`,
        description: libraryErrorText(i18n, result.error),
      });
      return;
    }
    const { saved, fileName } = result.value;
    if (!saved) return;
    toast({
      title: fileName ? (
        <Trans>
          Saved <UserContent translate="no">{fileName}</UserContent>
        </Trans>
      ) : (
        t`Template file saved`
      ),
      description: t`It has the template’s structure only: no frames, words or sound from the reel.`,
    });
  };

  return { save, saving };
}
