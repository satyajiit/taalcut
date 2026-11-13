// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a person can do to one export, from its row or from the moment its end gets on Exports (UX4): cancel it,
 * show it in Finder, export it again for a preset, delete it (Undo in the toast). Each is a command from 'ui', and
 * a refusal says its cause in a toast; `busy` names the press still on its way, so its button spins.
 */
import { Trans, useLingui } from '@lingui/react/macro';
import {
  callRpc,
  newId,
  RENDER_COMMANDS,
  type ExportPresetId,
  type RenderSnapshot,
  type TaalcutError,
} from '@taalcut/core';
import { errorMessage, toast, UserContent } from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useUndoable } from '../make/use-undoable';

export const RUNNING: ReadonlySet<RenderSnapshot['status']> = new Set([
  'queued',
  'rendering',
  'checking',
  'fixing',
]);
export const PRESET_IDS: readonly ExportPresetId[] = ['reels', 'shorts', 'tiktok', 'device', 'deviceHevc'];

export interface RenderActions {
  /** The press on its way: 'cancel', 'reveal' or `export:<preset>`. */
  readonly busy: string | null;
  readonly deleting: boolean;
  cancel(): Promise<void>;
  reveal(): Promise<void>;
  exportAs(presetId: ExportPresetId): Promise<void>;
  remove(): void;
}

function Deleted({ name }: { name: string }) {
  return (
    <Trans>
      Deleted <UserContent translate="no">{name}</UserContent>
    </Trans>
  );
}

export function useRenderActions(render: RenderSnapshot): RenderActions {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const undoable = useUndoable();
  const [busy, setBusy] = useState<string | null>(null);

  const failed = (title: string, error: TaalcutError) =>
    toast({ tone: 'danger', title, description: errorMessage(i18n, error) });
  const press = async (key: string, run: () => Promise<void>) => {
    setBusy(key);
    try {
      await run();
    } finally {
      setBusy(null);
    }
  };
  const dispatch = (name: string, payload: unknown) =>
    callRpc(backend.commands.dispatch({ name, payload, source: 'ui', idempotencyKey: newId() }));

  return {
    busy,
    deleting: undoable.pending,
    exportAs: (presetId) =>
      press(`export:${presetId}`, async () => {
        const result = await dispatch(RENDER_COMMANDS.export, {
          projectId: render.projectId,
          timelineId: render.timelineId,
          presetId,
          captions: render.captions,
        });
        if (!result.ok) failed(t`Couldn’t start the export`, result.error);
      }),
    cancel: () =>
      press('cancel', async () => {
        const result = await dispatch(RENDER_COMMANDS.cancel, {
          projectId: render.projectId,
          renderId: render.id,
        });
        if (!result.ok) failed(t`Couldn’t stop the export`, result.error);
      }),
    reveal: () =>
      press('reveal', async () => {
        const result = await callRpc(backend.files.revealRender({ renderId: render.id }));
        if (!result.ok) failed(t`Couldn’t show it in Finder`, result.error);
      }),
    remove: () =>
      void undoable.run({
        name: RENDER_COMMANDS.delete,
        payload: { projectId: render.projectId, renderId: render.id },
        projectId: render.projectId,
        done: <Deleted name={render.name} />,
        failed: t`Couldn’t delete the export`,
      }),
  };
}
