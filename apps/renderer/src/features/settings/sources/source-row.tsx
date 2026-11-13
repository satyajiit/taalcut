// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: source row (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + UX4 (_orch/ux4/specs/design-set.md "One row")
 * one SettingRow: the kind's glyph (a folder, a drive, a phone), the source's name (the user's words, not
 *   translated), its folder as the row's line, its state line under it; Check again when looking again would help;
 *   Remove (undoable: the toast's Undo); a More menu with Watch for new clips and Look through it again. No accent:
 *   the row is the user's footage, said in words.
 * states: default · hover (the buttons'; the row itself doesn't act, so it doesn't wash) · focus (the base ring on
 *   every control) · active · disabled (n/a: every action can run) · loading (the pressed action spins, the others
 *   wait) · error (the cause under the state line) · success (silent: the list re-reads and the row shows the new
 *   state; a removal's toast carries Undo)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { ImportStatus, SourceView } from '@taalcut/core';
import {
  Button,
  CONCEPT_ICONS,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { HardDrive, Package } from 'lucide-react';
import { useId } from 'react';
import { describeError } from '../model-messages';
import { SettingRow } from '../rows';
import { SourceStatusLine, useSourceState } from './source-status';
import type { SourceActions } from './use-source-actions';

/** The kind's glyph: the registry's folder and phone; a drive and a fetched clip are the sources' own. */
function kindIcon(source: SourceView) {
  if (source.kind === 'wifi_import' || source.kind === 'usb_import') return CONCEPT_ICONS.phone;
  if (source.kind === 'watched_folder')
    return source.path?.startsWith('/Volumes/') ? HardDrive : CONCEPT_ICONS.folder;
  return Package;
}

/** Looking through the folder again can help: it errored, or Taalcut can't reach it right now. */
function wantsRescan(source: SourceView): boolean {
  return source.scan.state === 'error' || source.status !== 'online';
}

export function SourceRow({
  source,
  running,
  actions,
  now,
}: {
  source: SourceView;
  running: ImportStatus | undefined;
  actions: SourceActions;
  now?: number;
}) {
  const { t, i18n } = useLingui();
  const statusId = useId();
  // Each button's name is its own words then the source's (aria-labelledby), as render-row's are: the folder's
  // name stays data, never inside a catalogue string, and the visible words lead the name (axe).
  const nameId = useId();
  const checkId = useId();
  const removeId = useId();
  const moreId = useId();
  const state = useSourceState(source, running, now);
  const busy = actions.busyOf(source.id);
  const error = actions.errorOf(source.id);
  const folder = source.kind === 'watched_folder';
  // Stock and generated clips belong to the videos that use them: only folders and phones are removed here.
  const removable = folder || source.kind === 'wifi_import' || source.kind === 'usb_import';
  const scanning = source.scan.state === 'scanning';

  return (
    <SettingRow
      data-source={source.id}
      data-kind={source.kind}
      data-status={source.status}
      aria-describedby={statusId}
      icon={kindIcon(source)}
      title={
        <UserContent id={nameId} translate="no" className="block truncate">
          {source.name}
        </UserContent>
      }
      description={
        source.path ? (
          <UserContent translate="no" title={source.path} className="block truncate">
            {source.path}
          </UserContent>
        ) : undefined
      }
      control={
        <span className="flex items-center gap-1">
          {folder && wantsRescan(source) ? (
            <Button
              size="sm"
              variant="secondary"
              icon={VERB_ICONS.checkAgain}
              loading={busy === 'rescan'}
              disabled={busy !== null && busy !== 'rescan'}
              onClick={() => void actions.rescan(source)}
              aria-labelledby={`${checkId} ${nameId}`}
            >
              <span id={checkId}>
                <Trans>Check again</Trans>
              </span>
            </Button>
          ) : null}
          {removable ? (
            <Button
              size="sm"
              variant="ghost"
              icon={VERB_ICONS.forget}
              data-action="remove-source"
              loading={busy === 'remove'}
              disabled={busy !== null && busy !== 'remove'}
              onClick={() => void actions.remove(source)}
              aria-labelledby={`${removeId} ${nameId}`}
            >
              <span id={removeId}>
                <Trans>Remove</Trans>
              </span>
            </Button>
          ) : null}
          {folder ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  loading={busy === 'watch'}
                  icon={busy === 'watch' ? undefined : VERB_ICONS.more}
                  aria-labelledby={`${moreId} ${nameId}`}
                >
                  <span id={moreId} className="sr-only">
                    {t`More for`}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuCheckboxItem
                  checked={source.watch}
                  onCheckedChange={(watch) => void actions.setWatch(source, watch === true)}
                >
                  <Trans>Watch for new clips</Trans>
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem disabled={scanning} onSelect={() => void actions.rescan(source)}>
                  <Trans>Look through it again</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </span>
      }
    >
      <SourceStatusLine state={state} id={statusId} />
      {error ? (
        <p role="alert" className="m-0 type-meta text-danger-strong">
          {describeError(i18n, error)}
        </p>
      ) : null}
    </SettingRow>
  );
}
