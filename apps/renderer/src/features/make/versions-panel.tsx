// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: versions panel (P2-X3) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the timeline's saved snapshots, newest first, as hairline rows: its number, what made
 *   it (saved automatically, your name for it, the export it went out as, the moment before a restore) and when;
 *   Restore on each, itself undoable (the toast's Undo and ⌘Z put back what was there). Saving one with a name
 *   is a field at the top.
 * states: loading (bone rows) · error (the cause, Try again) · empty ("No versions yet…") · default · the one on
 *   the timeline now ("On the timeline", no Restore) · saving (Save spins; the field stays) · save failed (the
 *   toast with the cause) · restoring (that row's Restore spins) · restored (the toast, with Undo)
 * pre-emit critique: P5 H4 E4 S5 R5 V4
 */
import { Trans, useLingui } from '@lingui/react/macro';
import {
  PROJECT_COMMANDS,
  type ProjectId,
  type TimelineId,
  type TimelineVersionSummary,
} from '@taalcut/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ErrorLine,
  Input,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { History, MoreHorizontal, PencilLine, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { formatDateTime } from '../shared/format';
import { RenameDialog } from './rename-dialog';
import { useUndoable } from './use-undoable';
import { VersionsHistorySection } from './versions-history-section';

export interface VersionsPanelProps {
  projectId: ProjectId;
  timelineId: TimelineId;
  onClose: () => void;
}

function What({ version }: { version: TimelineVersionSummary }) {
  const { t } = useLingui();
  switch (version.kind) {
    case 'named':
      return version.label ? (
        <UserContent translate="no" className="text-sm font-medium text-ink">
          {version.label}
        </UserContent>
      ) : (
        <span className="text-sm text-ink">{t`Saved by you`}</span>
      );
    case 'export':
      return (
        <span className="text-sm text-ink">
          {t`Exported:`}{' '}
          <UserContent translate="no" className="font-medium">
            {version.label ?? ''}
          </UserContent>
        </span>
      );
    case 'before-restore':
      return <span className="text-sm text-ink">{t`Just before you restored a version`}</span>;
    case 'auto':
      return <span className="text-sm text-ink">{t`Saved automatically`}</span>;
  }
}

export function VersionsPanel({ projectId, timelineId, onClose }: VersionsPanelProps) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const fieldId = useId();
  const undoable = useUndoable();
  const [round, setRound] = useState(0);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<TimelineVersionSummary | null>(null);
  const versions = useRpcQuery(
    (signal) => backend.projects.versions({ timelineId, limit: 200 }, { signal }),
    [backend, timelineId, round],
  );
  const timeline = useRpcQuery(
    (signal) => backend.timelines.get({ timelineId }, { signal }),
    [backend, timelineId, round],
  );
  useBackendEvents(['library.changed'], ({ payload }) => {
    if (payload.projectId === projectId && (payload.entity === 'project' || payload.entity === 'timeline'))
      setRound((n) => n + 1);
  });

  const items = versions.data?.items;
  const revision = timeline.data?.revision;
  // The newest snapshot of what the timeline shows now.
  const currentId = items?.find((version) => version.revision === revision)?.id;
  const run = async (key: string, request: Parameters<typeof undoable.run>[0]) => {
    setBusy(key);
    try {
      return await undoable.run(request);
    } finally {
      setBusy(null);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const name = label.trim();
    const result = await run('save', {
      name: PROJECT_COMMANDS.saveVersion,
      payload: { projectId, timelineId, ...(name ? { label: name } : {}) },
      projectId,
      done: name ? (
        <Trans>
          Saved <UserContent translate="no">{name}</UserContent>
        </Trans>
      ) : (
        t`Saved this version`
      ),
      failed: t`Couldn’t save the version`,
    });
    if (result.ok) setLabel('');
  };

  return (
    <section
      aria-labelledby="versions-heading"
      data-slot="versions-panel"
      className="flex min-h-0 flex-col gap-4"
    >
      <div className="flex items-center gap-2">
        <History aria-hidden className="size-4 text-ink-2" />
        <h2 id="versions-heading" className="m-0 flex-1 text-md font-semibold text-ink">
          {t`Versions`}
        </h2>
        <Button size="icon" variant="ghost" aria-label={t`Close versions`} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      <VersionsHistorySection projectId={projectId} />
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium text-ink">
          {t`Save what’s on the timeline`}
        </label>
        <div className="flex gap-2">
          <Input
            id={fieldId}
            value={label}
            maxLength={100}
            placeholder={t`A name, if you like`}
            autoComplete="off"
            translate="no"
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button type="submit" loading={busy === 'save'}>
            {t`Save`}
          </Button>
        </div>
      </form>
      {versions.error && !items ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorLine error={versions.error} />
          <Button size="sm" icon={VERB_ICONS.retry} onClick={versions.reload}>
            {t`Try again`}
          </Button>
        </div>
      ) : !items ? (
        <ul
          aria-busy="true"
          aria-label={t`Loading the versions`}
          className="m-0 flex list-none flex-col gap-3 p-0"
        >
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} aria-hidden className="flex flex-col gap-1.5">
              <span className="tc-bone block h-4 w-40 rounded-sm bg-hover" />
              <span className="tc-bone block h-3 w-28 rounded-sm bg-hover" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">
          {t`No versions yet. Taalcut saves one as you work, and each export keeps the one it used.`}
        </p>
      ) : (
        <ul
          aria-labelledby="versions-heading"
          className="m-0 flex min-h-0 list-none flex-col overflow-y-auto p-0"
        >
          {items.map((version) => {
            const number = i18n.number(version.number);
            const current = version.id === currentId;
            return (
              <li
                key={version.id}
                data-slot="version-row"
                data-kind={version.kind}
                className="flex items-start gap-2 border-b border-rule-subtle py-2.5 last:border-b-0"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-medium text-ink-2 tabular-nums">{t`Version ${number}`}</span>
                    <What version={version} />
                  </span>
                  <span className="text-xs text-ink-2">
                    <time dateTime={new Date(version.createdAt).toISOString()} className="font-sans">
                      {formatDateTime(i18n, version.createdAt)}
                    </time>
                    {current ? ` · ${t`On the timeline now`}` : null}
                  </span>
                </div>
                {current ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === version.id}
                    aria-label={t`Restore version ${number}`}
                    onClick={() =>
                      void run(version.id, {
                        name: PROJECT_COMMANDS.restoreVersion,
                        payload: { projectId, timelineId, versionId: version.id },
                        projectId,
                        done: t`Restored version ${number}`,
                        failed: t`Couldn’t restore that version`,
                      })
                    }
                  >
                    {t`Restore`}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" aria-label={t`More for version ${number}`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRenaming(version)}>
                      <PencilLine aria-hidden />
                      {version.label ? t`Rename…` : t`Name it…`}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}
      <RenameDialog
        open={renaming !== null}
        onOpenChange={(open) => (open ? null : setRenaming(null))}
        title={t`Name this version`}
        label={t`Name`}
        value={renaming?.label ?? ''}
        maxLength={100}
        onSave={(name) =>
          undoable.run({
            name: PROJECT_COMMANDS.renameVersion,
            payload: { projectId, versionId: renaming!.id, label: name },
            projectId,
            done: (
              <Trans>
                Named it <UserContent translate="no">{name}</UserContent>
              </Trans>
            ),
            failed: t`Couldn’t name the version`,
          })
        }
      />
    </section>
  );
}
