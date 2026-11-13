// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: Look menu (P3-V10) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the kit's LookPicker in the window bar of the editor and the template page: None, the brand kits, the looks,
 *   Manage brand kits…; a pick is timeline.setStyle (the video's history) or template.setStyle (a new template
 *   version, app-wide), with Undo in the toast
 * states: LookPicker's (loading, busy, failed, missing, disabled on an older template version) · success (the
 *   toast names the look) · error (the toast says why; the button turns danger until the next pick)
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { Trans, useLingui } from '@lingui/react/macro';
import {
  TEMPLATE_COMMANDS,
  TIMELINE_COMMANDS,
  type ProjectId,
  type StyleId,
  type Template,
  type Timeline,
} from '@taalcut/core';
import { LookPicker, UserContent } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useLogoUrl, useStyles } from '../../brand/use-styles';
import { useUndoable } from '../../make/use-undoable';

/** What a Look menu sets the look of: a video in the editor, or a template. */
export type LookTarget =
  | { readonly kind: 'timeline'; readonly projectId: ProjectId; readonly timeline: Timeline }
  | { readonly kind: 'template'; readonly template: Template; readonly readOnly: boolean };

/** P3-V10: the Look menu in the window bar (None, brand kits, looks, Manage brand kits…). */
export function LookMenu({
  target,
  compact = false,
}: {
  readonly target: LookTarget;
  readonly compact?: boolean;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const styles = useStyles();
  const logoUrl = useLogoUrl();
  const undoable = useUndoable();
  const [failed, setFailed] = useState(false);
  const value = target.kind === 'timeline' ? target.timeline.styleId : target.template.styleId;

  const pick = async (styleId: StyleId | null) => {
    setFailed(false);
    const name = styles.data?.find((style) => style.id === styleId)?.name;
    const done = name ? (
      <Trans>
        Look: <UserContent translate="no">{name}</UserContent>
      </Trans>
    ) : (
      t`No look: the brand kit is off`
    );
    const result = await undoable.run(
      target.kind === 'timeline'
        ? {
            name: TIMELINE_COMMANDS.setStyle,
            payload: { projectId: target.projectId, timelineId: target.timeline.id, styleId },
            projectId: target.projectId,
            done,
            failed: t`Couldn’t change the look`,
          }
        : {
            name: TEMPLATE_COMMANDS.setStyle,
            payload: {
              projectId: null,
              templateId: target.template.id,
              baseVersion: target.template.version,
              styleId,
            },
            projectId: null,
            done,
            failed: t`Couldn’t change the template’s look`,
          },
    );
    setFailed(!result.ok);
  };

  return (
    <LookPicker
      styles={styles.data}
      value={value}
      onChange={(styleId) => void pick(styleId)}
      onManage={() => void navigate({ to: '/settings/brand' })}
      logoUrl={logoUrl}
      disabled={target.kind === 'template' && target.readOnly}
      busy={undoable.pending}
      failed={failed}
      compact={compact}
    />
  );
}
