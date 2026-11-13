// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: apply-a-look dialog (P3-V16) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * one look on every video of several projects, in one step: from /projects the look is picked here (brand kits,
 *   looks, caption styles, each a radio row); from a brand kit the projects are (checkbox rows). It says how many
 *   videos that is, and Apply runs batch.applyStyle once; the toast says what was skipped, with Undo
 * states: loading (the videos being counted: Apply busy) · default · nothing picked (Apply disabled, the line
 *   says what to pick) · no videos (the line says so) · too many (over 50: the line says to pick fewer) · applying
 *   (Apply loading, keeps focus) · error (the cause under the list) · success (closes; the toast)
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { CAPTION_PRESET_IDS, type ProjectId, type ProjectSummary } from '@taalcut/core';
import {
  Button,
  CAPTION_PRESET_LABELS,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  StyleChip,
  UserContent,
} from '@taalcut/ui';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { useLogoUrl, useStyles } from '../../brand/use-styles';
import { RadioRow } from '../../settings/radio-row';
import { BATCH_LIMIT, useApplyLook, videosOf, type PickedLook } from './use-apply-look';

type Named = Pick<ProjectSummary, 'id' | 'name'>;

export interface ApplyLookDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The projects (from /projects' selection); absent: picked here. */
  readonly projects?: readonly Named[];
  /** The look (from a brand kit); absent: picked here. */
  readonly look?: PickedLook;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex flex-col">
      <p className="m-0 px-4 pt-2 pb-1 text-xs font-semibold text-ink-3">{title}</p>
      {children}
    </div>
  );
}

function LookChoices({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (key: string, look: PickedLook) => void;
}) {
  const { t, i18n } = useLingui();
  const name = useId();
  const styles = useStyles();
  const logoUrl = useLogoUrl();
  const row = (key: string, look: PickedLook, label: ReactNode) => (
    <RadioRow
      key={key}
      id={`${name}-${key}`}
      name={name}
      value={key}
      checked={value === key}
      onChoose={() => onChange(key, look)}
    >
      {label}
    </RadioRow>
  );
  const kits = styles.data?.filter((style) => style.kind === 'brandKit') ?? [];
  const looks = styles.data?.filter((style) => style.kind === 'look') ?? [];
  const styleRow = (style: (typeof kits)[number]) =>
    row(
      `style:${style.id}`,
      { kind: 'style', style },
      <StyleChip
        size="sm"
        name={style.name}
        colours={style.colours}
        logoUrl={logoUrl(style)}
        kind="brandKit"
        isDefault={style.isDefault}
      />,
    );
  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border border-rule-subtle bg-raised py-1">
      {kits.length > 0 ? <Group title={t`Brand kits`}>{kits.map(styleRow)}</Group> : null}
      {looks.length > 0 ? <Group title={t`Looks`}>{looks.map(styleRow)}</Group> : null}
      <Group title={t`Caption styles`}>
        {CAPTION_PRESET_IDS.map((presetId) =>
          row(
            `preset:${presetId}`,
            { kind: 'captionPreset', presetId },
            i18n._(CAPTION_PRESET_LABELS[presetId]),
          ),
        )}
      </Group>
    </div>
  );
}

function ProjectChoices({
  value,
  onChange,
}: {
  value: readonly ProjectId[];
  onChange: (ids: ProjectId[]) => void;
}) {
  const { t } = useLingui();
  const backend = useBackend();
  const list = useRpcQuery(
    (signal) => backend.projects.list({ archived: false, limit: 200 }, { signal }),
    [backend],
  );
  return (
    <div
      role="group"
      aria-label={t`Projects`}
      aria-busy={!list.data || undefined}
      className="max-h-80 overflow-y-auto rounded-lg border border-rule-subtle bg-raised py-1"
    >
      {list.data?.items.map((project) => (
        <label
          key={project.id}
          className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 hover:bg-hover has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-focus"
        >
          <input
            type="checkbox"
            checked={value.includes(project.id)}
            onChange={(event) =>
              onChange(
                event.target.checked ? [...value, project.id] : value.filter((id) => id !== project.id),
              )
            }
            className="size-4 shrink-0 cursor-pointer accent-ink outline-none"
          />
          <UserContent translate="no" className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {project.name}
          </UserContent>
          <span className="text-xs text-ink-2">
            {project.timelines === 0 ? (
              t`No video yet`
            ) : (
              <Plural value={project.timelines} one="# video" other="# videos" />
            )}
          </span>
        </label>
      ))}
    </div>
  );
}

export function ApplyLookDialog({ open, onOpenChange, projects, look }: ApplyLookDialogProps) {
  const { t } = useLingui();
  const backend = useBackend();
  const [picked, setPicked] = useState<{ key: string; look: PickedLook } | null>(null);
  const [chosen, setChosen] = useState<ProjectId[]>([]);
  const { apply, pending } = useApplyLook();
  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setChosen([]);
  }, [open]);
  const ids = projects ? projects.map((project) => project.id) : chosen;
  const videos = useRpcQuery(
    (signal) => (open ? videosOf(backend, ids, signal) : Promise.resolve([])),
    [backend, open, ids.join()],
  );
  const items = videos.data ?? [];
  const what = look ?? picked?.look ?? null;
  const tooMany = items.length > BATCH_LIMIT;
  const ready = what !== null && items.length > 0 && !tooMany && videos.status === 'ready';
  const title = look?.kind === 'style' ? look.style.name : null;

  const line =
    ids.length === 0
      ? t`Pick the projects to apply it to.`
      : videos.status !== 'ready'
        ? t`Counting the videos…`
        : items.length === 0
          ? t`These projects have no videos yet.`
          : tooMany
            ? t`That’s more than 50 videos. Pick fewer projects: a look goes on up to 50 at once.`
            : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-slot="apply-look-dialog">
        <DialogHeader>
          <DialogTitle>
            {title ? (
              <Trans>
                Apply <UserContent translate="no">{title}</UserContent> to videos
              </Trans>
            ) : (
              t`Apply a look`
            )}
          </DialogTitle>
          <DialogDescription>
            {projects ? (
              <Plural
                value={projects.length}
                one="To every video of the project you picked. It’s one step: Undo puts every video back."
                other="To every video of the # projects you picked. It’s one step: Undo puts every video back."
              />
            ) : (
              t`To every video of the projects you pick. It’s one step: Undo puts every video back.`
            )}
          </DialogDescription>
        </DialogHeader>
        {look ? (
          <ProjectChoices value={chosen} onChange={setChosen} />
        ) : (
          <LookChoices value={picked?.key ?? null} onChange={(key, next) => setPicked({ key, look: next })} />
        )}
        <p aria-live="polite" className="m-0 min-h-5 text-sm text-ink-2">
          {line ??
            (what ? (
              <Plural value={items.length} one="# video gets this look." other="# videos get this look." />
            ) : (
              <Plural
                value={items.length}
                one="# video. Pick a look to put on it."
                other="# videos. Pick a look to put on them."
              />
            ))}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t`Cancel`}
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            loading={pending}
            onClick={async () => {
              if (!what || !ready) return;
              const result = await apply(items, what);
              if (result.ok) onOpenChange(false);
            }}
          >
            {t`Apply`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
