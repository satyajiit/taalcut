// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: brand kit actions (P3-V10) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * the editor's window-bar actions: Use on a template… (template.setStyle on the template picked), Apply to
 *   videos… (batch.applyStyle over picked projects), and More: Make default for new videos (style.setDefault),
 *   Delete brand kit… (refused while used, saying where: styles.usedBy); each with Undo in its toast
 * states: default · hover/active/focus-visible/disabled (Buttons, menu items) · loading (a dialog's button) ·
 *   error (the dialog's line) · success (the toast, with Undo) · in use (Delete explains where, offers no delete)
 *   · already default (the item says so, disabled) · no templates (the dialog says so)
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { STYLE_COMMANDS, TEMPLATE_COMMANDS, type StyleSummary, type TemplateId } from '@taalcut/core';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  UserContent,
  useShortcutFormat,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { LayoutTemplate, MoreHorizontal, Palette, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';
import { UNDO_SHORTCUT, useUndoable } from '../make/use-undoable';
import { ApplyLookDialog } from '../projects/batch/apply-look-dialog';
import { ChoiceRow, ChoiceRows } from '../settings/radio-row';
import { COMPACT_WORD, CompactTip } from '../shared/compact-toolbar';
import { styleErrorMessage, usageWords } from './brand-words';
import { useStyleUsage } from './use-styles';

type Kit = Pick<StyleSummary, 'id' | 'name' | 'kind' | 'isDefault'>;
type Dialogs = 'template' | 'videos' | 'delete' | null;

function UseOnTemplate({
  kit,
  open,
  onOpenChange,
}: {
  kit: Kit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const undoable = useUndoable();
  const [picked, setPicked] = useState<TemplateId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useRpcQuery(
    (signal) => (open ? backend.templates.list({ limit: 100 }, { signal }) : Promise.resolve(null)),
    [backend, open],
  );
  const templates = list.data?.items ?? [];
  const template = templates.find((item) => item.id === picked);
  const kitName = kit.name;
  const apply = async () => {
    if (!template) return;
    const templateName = template.name;
    setError(null);
    const result = await undoable.run({
      name: TEMPLATE_COMMANDS.setStyle,
      payload: { projectId: null, templateId: template.id, baseVersion: template.head, styleId: kit.id },
      projectId: null,
      done: (
        <Trans>
          <UserContent translate="no">{templateName}</UserContent> uses{' '}
          <UserContent translate="no">{kitName}</UserContent> now
        </Trans>
      ),
      failed: t`Couldn’t put the brand kit on that template`,
    });
    if (result.ok) onOpenChange(false);
    else setError(styleErrorMessage(i18n, result.error));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-slot="use-on-template-dialog">
        <DialogHeader>
          <DialogTitle>{t`Use on a template`}</DialogTitle>
          <DialogDescription>
            {t`Videos made from the template get this kit’s look. The template keeps its slots and timing.`}
          </DialogDescription>
        </DialogHeader>
        {list.data && templates.length === 0 ? (
          <p className="m-0 type-body text-ink-2">{t`No templates yet. Make one from a reel first.`}</p>
        ) : (
          <ChoiceRows
            aria-label={t`Templates`}
            aria-busy={!list.data || undefined}
            value={picked ?? ''}
            onValueChange={(value) => setPicked(value as TemplateId)}
            className="max-h-80 overflow-y-auto"
          >
            {templates.map((item) => (
              <ChoiceRow
                key={item.id}
                value={item.id}
                label={<UserContent translate="no">{item.name}</UserContent>}
                trailing={
                  item.styleId === kit.id ? <Badge shape="chip">{t`Uses this kit`}</Badge> : undefined
                }
              />
            ))}
          </ChoiceRows>
        )}
        {error ? (
          <p role="alert" className="m-0 type-body text-danger-strong">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t`Cancel`}
          </Button>
          <Button
            variant="primary"
            disabled={!template}
            loading={undoable.pending}
            onClick={() => void apply()}
          >
            {t`Use on this template`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteKit({
  kit,
  open,
  onOpenChange,
}: {
  kit: Kit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  const undoKeys = useShortcutFormat().text(UNDO_SHORTCUT);
  const navigate = useNavigate();
  const undoable = useUndoable();
  const usage = useStyleUsage(kit.id);
  const [error, setError] = useState<string | null>(null);
  const used = usage.data ? usage.data.timelines + usage.data.templates > 0 : false;
  const kitName = kit.name;
  const where = usage.data ? usageWords(i18n, usage.data) : '';
  const remove = async () => {
    setError(null);
    const result = await undoable.run({
      name: STYLE_COMMANDS.remove,
      payload: { projectId: null, styleId: kit.id },
      projectId: null,
      done: (
        <Trans>
          Deleted <UserContent translate="no">{kitName}</UserContent>
        </Trans>
      ),
      failed: t`Couldn’t delete the brand kit`,
    });
    if (!result.ok) return setError(styleErrorMessage(i18n, result.error));
    onOpenChange(false);
    void navigate({ to: '/settings/brand' });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-slot="delete-kit-dialog">
        <DialogHeader>
          <DialogTitle>
            <Trans>
              Delete <UserContent translate="no">{kitName}</UserContent>?
            </Trans>
          </DialogTitle>
          <DialogDescription>
            {!usage.data
              ? t`Checking where it’s used…`
              : used
                ? t`It’s used by ${where}. Give them another look first (None, or another kit), then delete it.`
                : t`Nothing uses it. You can undo this with Undo or ${undoKeys}.`}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="m-0 type-body text-danger-strong">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {used ? t`Close` : t`Cancel`}
          </Button>
          {used ? null : (
            <Button
              variant="destructive"
              disabled={!usage.data}
              loading={undoable.pending}
              onClick={() => void remove()}
            >
              {t`Delete brand kit`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BrandActions({ kit }: { kit: Kit }) {
  const { t } = useLingui();
  const undoable = useUndoable();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const kitName = kit.name;
  const opener = (which: Exclude<Dialogs, null>) => (open: boolean) => setDialog(open ? which : null);
  const makeDefault = () =>
    void undoable.run({
      name: STYLE_COMMANDS.setDefault,
      payload: { projectId: null, styleId: kit.id },
      projectId: null,
      done: (
        <Trans>
          New videos get <UserContent translate="no">{kitName}</UserContent>
        </Trans>
      ),
      failed: t`Couldn’t make it the default`,
    });
  return (
    <>
      <CompactTip label={t`Use on a template…`}>
        <Button size="sm" variant="ghost" onClick={() => setDialog('template')}>
          <LayoutTemplate aria-hidden />
          <span className={COMPACT_WORD}>{t`Use on a template…`}</span>
        </Button>
      </CompactTip>
      <CompactTip label={t`Apply to videos…`}>
        <Button size="sm" variant="ghost" onClick={() => setDialog('videos')}>
          <Palette aria-hidden />
          <span className={COMPACT_WORD}>{t`Apply to videos…`}</span>
        </Button>
      </CompactTip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t`More for this brand kit`}
            loading={undoable.pending}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem disabled={kit.isDefault} onSelect={makeDefault}>
            <Star aria-hidden />
            {kit.isDefault ? t`New videos get this kit` : t`Make default for new videos`}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
            <Trash2 aria-hidden />
            {t`Delete brand kit…`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <UseOnTemplate kit={kit} open={dialog === 'template'} onOpenChange={opener('template')} />
      <ApplyLookDialog
        open={dialog === 'videos'}
        onOpenChange={opener('videos')}
        look={{ kind: 'style', style: kit }}
      />
      {/* Mounted while open: it asks styles.usedBy only then. */}
      {dialog === 'delete' ? <DeleteKit kit={kit} open onOpenChange={opener('delete')} /> : null}
    </>
  );
}
