// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: design files history (HFW1-UI) · genre: atmospheric studio app (the editor's dock)
 * system: DESIGN.md v0.3 · every version of the project's design files, newest first: "Version 3", who wrote it
 *   (Taalcut, you, an outside app) and when, how many files, the current one marked "Now"; choosing one shows its
 *   files above; Restore version N makes it the current one again (workspace.restore: one ⌘Z), which is what the
 *   AI designs from next; graphics on the video keep their designs
 * keyboard: one tab stop (a listbox): ↑ ↓ Home End move, Return chooses; then Restore
 * states: default · hover · focus · selected · current ("Now") · restoring (the button busy) · restored (a line
 *   that ⌘Z puts it back) · error (under the button) · empty (no versions yet: one line) · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { TaalcutError, WorkspaceListing, WorkspaceRevision } from '@taalcut/core';
import { Button, Chip, cn, ErrorLine, useFormatters, useShortcutFormat, VERB_ICONS } from '@taalcut/ui';
import { useMemo } from 'react';
import { useLaneListbox } from '../use-lane-listbox';

export interface RevisionListProps {
  readonly listing: WorkspaceListing;
  /** The version whose files show above; null while the design's own show. */
  readonly viewing: number | null;
  readonly onView: (revision: number) => void;
  readonly onRestore: (revision: number) => void;
  readonly restoring: boolean;
  readonly restored: number | null;
  readonly error: TaalcutError | null;
}

export function RevisionList(props: RevisionListProps) {
  const { listing, viewing, onView, onRestore, restoring, restored, error } = props;
  const { t, i18n } = useLingui();
  const formats = useFormatters();
  const undoKeys = useShortcutFormat().text('mod+z');
  const ids = useMemo(() => listing.revisions.map((each) => String(each.revision)), [listing.revisions]);
  const list = useLaneListbox(ids, viewing === null ? null : String(viewing), (id) => onView(Number(id)));
  const who = (origin: WorkspaceRevision['origin']) =>
    origin === 'agent' ? t`By Taalcut` : origin === 'mcp' ? t`By an outside app` : t`By you`;
  if (listing.revisions.length === 0)
    return <p className="m-0 type-meta text-ink-2">{t`No versions of these files yet.`}</p>;
  const chosen = viewing !== null && viewing !== listing.head ? viewing : null;
  const chosenWords = chosen === null ? '' : i18n.number(chosen);
  const restoredWords = restored === null ? '' : i18n.number(restored);
  return (
    <div className="flex flex-col gap-2">
      <div
        {...list.listbox}
        aria-label={t`Versions`}
        data-slot="design-revisions"
        className="flex flex-col gap-0.5 rounded-md p-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      >
        {listing.revisions.map((revision) => {
          const id = String(revision.revision);
          const n = i18n.number(revision.revision);
          const files = plural(revision.files.length, { one: '# file', other: '# files' });
          const selected = revision.revision === viewing;
          return (
            <div
              key={id}
              id={list.optionId(id)}
              role="option"
              aria-selected={selected}
              data-revision={revision.revision}
              className={cn(
                'flex min-h-10 cursor-pointer flex-col justify-center rounded-md px-2 py-1 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover',
                selected && 'bg-selected hover:bg-selected',
                id === list.active && 'outline-1 -outline-offset-1 outline-rule-strong',
              )}
              onClick={() => {
                list.setActive(id);
                onView(revision.revision);
              }}
            >
              <span className="flex items-center gap-2 type-label text-ink">
                {t`Version ${n}`}
                {revision.revision === listing.head ? <Chip tone="primary">{t`Now`}</Chip> : null}
              </span>
              <span className="type-meta text-ink-2">
                {who(revision.origin)} · <time>{formats.dateTime(revision.createdAt)}</time> · {files}
              </span>
            </div>
          );
        })}
      </div>
      {chosen !== null ? (
        <div className="flex flex-col gap-1.5">
          <div>
            <Button size="sm" icon={VERB_ICONS.restore} loading={restoring} onClick={() => onRestore(chosen)}>
              {t`Restore version ${chosenWords}`}
            </Button>
          </div>
          <p className="m-0 type-meta text-ink-2">
            {t`Taalcut designs from the current version next. Graphics on the video keep their designs.`}
          </p>
        </div>
      ) : null}
      {restored !== null && restored === listing.head ? (
        <p role="status" className="m-0 type-meta text-ink-2">
          {t`Version ${restoredWords} is the current one again. ${undoKeys} puts it back.`}
        </p>
      ) : null}
      {error ? <ErrorLine key={error.code} error={error} /> : null}
    </div>
  );
}
