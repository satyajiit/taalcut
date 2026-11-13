// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { Button, ErrorLine } from '@taalcut/ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useEditorDrafts } from '../../backend/backend';
import type { DraftTarget } from '../../backend/editor-drafts';

export function useTextDraft(target: DraftTarget, paused: boolean) {
  const drafts = useEditorDrafts();
  const draft = drafts.get(target);
  const state = useSyncExternalStore(draft.subscribe, draft.snapshot);
  const [error, setError] = useState<TaalcutError | null>(null);
  useEffect(() => draft.observe(target.timeline), [draft, target.timeline]);
  const save = async (overwrite = false) => {
    if (paused) return;
    setError(null);
    const result = await draft.save(overwrite);
    if (!result.ok) setError(result.error);
  };
  return { ...state, dirty: state.value !== state.base, set: draft.set, discard: draft.discard, save, error };
}

export function DraftConflict({
  draft,
  paused,
}: {
  draft: ReturnType<typeof useTextDraft>;
  paused: boolean;
}) {
  const { t } = useLingui();
  return (
    <>
      {draft.conflict ? (
        <div role="status" className="flex flex-wrap items-center gap-2 type-meta">
          <span>{t`This text changed while you were editing. Your draft is kept.`}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={paused || draft.saving}
            onClick={() => void draft.save(true)}
          >{t`Use my words`}</Button>
          <Button size="sm" variant="ghost" onClick={draft.discard}>{t`Use updated words`}</Button>
        </div>
      ) : null}
      {draft.error ? <ErrorLine error={draft.error} /> : null}
    </>
  );
}
