// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the clip's actions, in the window bar · genre: atmospheric studio app · system: DESIGN.md v0.4
 * the page's actions at the right of the bar (DESIGN.md, Window): one primary, Make a video, which opens a new chat
 *   with the clip named in the composer (the screen's one marigold fill, its word at every width); the rest in More
 *   (⋯): Analyse again (library.reindexAssets) and Remove from library (library.trashAssets: undoable, from the
 *   toast). Only what the library does today; Show in Finder is in the clip's facts, by its file
 * states: Make a video: default · hover · focus · active · disabled (the file can't be used: it couldn't be read or
 *   is gone; the line under the viewer says why) · loading n/a (it navigates at once) · error/success n/a
 *   · More: default · hover · focus · active · loading (while a command runs) · its items: default · highlighted
 *   (hover and arrows) · disabled (Analyse again while Taalcut is already looking) · error (a toast with the cause)
 *   · success (silent: the page shows the steps running; a removal leaves for the library with Undo)
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { callRpc, LIBRARY_COMMANDS, newId, type AssetDetail } from '@taalcut/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  errorMessage,
  toast,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { Clapperboard, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react';
import { useBackend } from '../../../backend/backend';
import { useCommand } from '../../../backend/use-command';
import { useReanalyse } from './progress/use-reanalyse';
import { COMPOSER_DRAFT_KEY } from '../../../chat/handoff';
import { addSelection, clearSelections } from '../../../chat/selection-store';
import { CompactTip } from '../../shared/compact-toolbar';
import { MakeShortButton } from '../../shorts/make-short-button';

export function ClipActions({ detail }: { detail: AssetDetail }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const command = useCommand({ toast: false });
  const { asset } = detail;
  const name = asset.name;
  const location = detail.locations[0];
  const unusable = asset.index.state === 'failed' || location?.state === 'missing' || asset.trashed;
  // Analyse again, shared with the page's other ways to it (LIB1-PROG): once asked, it isn't offered again until the
  // clip's steps say the work runs, and then not while Taalcut is looking at it.
  const reanalysis = useReanalyse(asset.id, detail);

  const makeVideo = () => {
    clearSelections();
    addSelection({ kind: 'asset', assetId: asset.id, name });
    try {
      sessionStorage.setItem(COMPOSER_DRAFT_KEY, t`Make a short video with my clip “${name}”`);
    } catch {
      // Storage blocked: the chat opens with an empty composer, which is still the way on.
    }
    void navigate({ to: '/chat/$conversationId', params: { conversationId: newId<'Conversation'>() } });
  };

  const fail = (title: string, error: Parameters<typeof errorMessage>[1]) =>
    toast({ tone: 'danger', title, description: errorMessage(i18n, error) });

  const analyseAgain = async () => {
    const result = await reanalysis.run();
    if (result.error) fail(t`Couldn’t start analysing ${name} again`, result.error);
  };

  const remove = async () => {
    const result = await command.run({
      name: LIBRARY_COMMANDS.trashAssets,
      payload: { assetIds: [asset.id] },
    });
    if (!result.ok) return fail(t`Couldn’t remove ${name}`, result.error);
    void navigate({ to: '/library' });
    toast({
      title: t`Removed ${name} from your library`,
      action: {
        label: t`Undo`,
        onSelect: () =>
          void callRpc(backend.commands.undo({ projectId: null, source: 'ui' })).then((undone) => {
            if (!undone.ok) fail(t`Couldn’t undo that`, undone.error);
          }),
      },
    });
  };

  return (
    <div className="flex items-center gap-1.5" data-slot="clip-actions">
      <DropdownMenu>
        <CompactTip label={t`More for this clip`}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={t`More for this clip`}
              loading={command.pending || reanalysis.busy}
            >
              {command.pending || reanalysis.busy ? null : <MoreHorizontal aria-hidden />}
            </Button>
          </DropdownMenuTrigger>
        </CompactTip>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem disabled={!reanalysis.available} onSelect={() => void analyseAgain()}>
            <RefreshCw aria-hidden />
            {t`Analyse again`}
          </DropdownMenuItem>
          {asset.trashed ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <Trash2 aria-hidden />
                {t`Remove from library`}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {asset.kind === 'video' ? (
        <MakeShortButton disabled={unusable} source={{ kind: 'asset', assetId: asset.id, name }} />
      ) : null}
      <Button
        size="sm"
        variant="primary"
        disabled={unusable}
        onClick={makeVideo}
        aria-label={t`Make a video with this clip`}
      >
        <Clapperboard aria-hidden />
        {t`Make a video`}
      </Button>
    </div>
  );
}
