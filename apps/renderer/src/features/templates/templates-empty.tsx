// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Your templates, empty (UX4 tpl) · system: DESIGN.md v0.6 + UX4 (EmptyState
 *   with Kaatu)
 * the library before its first template, as the kit's empty state: the shape a template takes (two ghost rows)
 *   above Kaatu and the words, and the paste-a-link field as its one action (Read this reel, the screen's one
 *   marigold); then the two other ways in, a line each: template files from someone (Import…, and dropping them
 *   anywhere on it) and Start from… for a ready-made one
 * states: the field's (reel-link-form: default · hover · focus · error · loading); Import…'s (import-drop.tsx);
 *   dragging files (the drop panel); Kaatu idles, then dozes
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, EmptyState, StaggerGroup, StaggerItem, cn } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { BeatStrip } from './beat-strip';
import { ImportButton, ImportDropZone, useImportTemplates } from './library/import-drop';
import { ReelLinkForm } from './reel-link-form';
import { TEMPLATE_ICONS } from './template-icons';

/** A link handed to the chat: the new conversation's composer opens with it as a draft. */
export { COMPOSER_DRAFT_KEY } from '../../chat/handoff';
export { parseReelLink } from './reel-link-form';

/** Two template rows, drawn empty: a reel's frame beside its slots on the beat. */
export function GhostTemplates({ rows = 2 }: { rows?: number }) {
  return (
    <StaggerGroup>
      <ul aria-hidden className="m-0 flex list-none flex-col gap-4 p-0">
        {Array.from({ length: rows }, (_, row) => (
          <li key={row} className={cn('flex items-center gap-4', row === 1 && 'opacity-60')}>
            <StaggerItem className="flex w-full items-center gap-4">
              <div className="aspect-[9/16] w-10 shrink-0 rounded-md border border-rule-subtle bg-rule-subtle/80" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className={cn('h-2.5 rounded-pill bg-rule-subtle', row === 0 ? 'w-40' : 'w-28')} />
                <BeatStrip />
              </div>
            </StaggerItem>
          </li>
        ))}
      </ul>
    </StaggerGroup>
  );
}

/** No template yet: the empty state in the library's place, then Import… and Start from… as the other ways in. */
export function EmptyLibrary() {
  const { t } = useLingui();
  const imports = useImportTemplates();
  return (
    <ImportDropZone onFiles={(files) => void imports.importFiles(files)}>
      <div className="flex flex-col gap-8" data-slot="templates-empty">
        <EmptyState
          titleAs="h2"
          title={<Trans>No templates yet</Trans>}
          description={
            <Trans>
              Paste a link to a reel you like. Taalcut learns its cuts and music beats and keeps them as a
              template you can use again.
            </Trans>
          }
          action={<ReelLinkForm compact className="w-full" />}
        >
          <GhostTemplates />
        </EmptyState>
        <div className="flex flex-col gap-2 type-body text-ink-2">
          <p className="m-0 flex flex-wrap items-center gap-3">
            {t`Have template files from someone? Bring them in.`}
            <ImportButton onFiles={(files) => void imports.importFiles(files)} pending={imports.pending} />
          </p>
          <p className="m-0 flex flex-wrap items-center gap-3">
            {t`No reel to copy? Start from a ready-made one.`}
            <Button asChild size="sm" variant="ghost" icon={TEMPLATE_ICONS.startFrom}>
              <Link to="/templates/start">{t`Start from…`}</Link>
            </Button>
          </p>
        </div>
      </div>
    </ImportDropZone>
  );
}
