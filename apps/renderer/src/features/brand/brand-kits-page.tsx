// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page: Settings › Brand kits (/settings/brand, P3-V10, UX4) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md "One row")
 * every brand kit, then every measured look, as SettingRows that are links (the whole row opens the editor, with its
 *   chevron): the logo (or its swatch), the name as written, "Default for new videos" on the one new videos get, the
 *   five colours and when it changed (HFW1 retire: the Motion design switch went with the kit's graphics). New brand
 *   kit in the window bar (the screen's one primary) makes one and opens it
 * states: loading (the named skeleton) · empty (Kaatu, one sentence, New brand kit as the only action) · filled · no looks
 *   (the Looks group is absent) · error (the cause, Try again) · creating (New brand kit loading) · created (the
 *   editor opens; the toast has Undo) · create failed (the toast says why)
 * motion: rows arrive once (Arrival); nothing else
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { newId, STYLE_COMMANDS, type StyleId, type StyleInput, type StyleSummary } from '@taalcut/core';
import {
  Arrival,
  Badge,
  Button,
  ColourDots,
  EmptyState,
  PageSection,
  Skeleton,
  StyleMark,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useUndoable } from '../make/use-undoable';
import { BoneRows, BoneSection } from '../settings/bones';
import { LoadError } from '../settings/fields';
import { SettingRow, SettingRows } from '../settings/rows';
import { SETTINGS_ICONS } from '../settings/settings-icons';
import { SettingsPage } from '../settings/settings-page';
import { formatDay } from '../shared/format';
import { useLogoUrl, useStyles } from './use-styles';

/** A new kit's starting point: warm, readable (text on background well over 4.5:1), no logo yet. */
function starterKit(name: string): StyleInput {
  return {
    name,
    kind: 'brandKit',
    colours: {
      primary: '#c2410c',
      secondary: '#fde68a',
      accent: '#0f766e',
      text: '#1c1917',
      background: '#fafaf9',
    },
    fonts: { heading: { family: 'poppins', weight: 700 }, body: { family: 'notoSans', weight: 400 } },
    captions: null,
    textStyles: {},
    logo: null,
    watermark: null,
    intro: null,
    outro: null,
    grade: null,
    fontMatch: null,
    madeFrom: null,
  };
}

function useNewKit() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const undoable = useUndoable();
  const create = async () => {
    const styleId: StyleId = newId<'Style'>();
    const name = t`New brand kit`;
    const made = await undoable.run({
      name: STYLE_COMMANDS.create,
      payload: { projectId: null, styleId, style: starterKit(name) },
      projectId: null,
      done: t`Made a new brand kit`,
      failed: t`Couldn’t make a brand kit`,
    });
    if (made.ok) void navigate({ to: '/settings/brand/$styleId', params: { styleId } });
  };
  return { create, pending: undoable.pending };
}

/** The list's shape while it loads: two kits, then a look. */
function BrandBones() {
  const kit = { title: '20%', lines: ['26%'], icon: true } as const;
  return (
    <div className="flex flex-col gap-10">
      <BoneSection title="12%" lines={[]}>
        <BoneRows rows={[kit, kit]} />
      </BoneSection>
      <BoneSection title="8%" lines={['52%']}>
        <BoneRows rows={[kit]} />
      </BoneSection>
    </div>
  );
}

function KitRow({ style }: { style: StyleSummary }) {
  const { t, i18n } = useLingui();
  const logoUrl = useLogoUrl();
  return (
    <SettingRow
      icon={<StyleMark name={style.name} colours={style.colours} logoUrl={logoUrl(style)} />}
      title={
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <UserContent translate="no" className="truncate">
            {style.name}
          </UserContent>
          {style.isDefault ? (
            <Badge shape="chip" tone="primary">
              {t`Default for new videos`}
            </Badge>
          ) : null}
        </span>
      }
      description={
        <span className="flex items-center gap-3">
          <ColourDots colours={style.colours} />
          <span>
            {t`Changed`}{' '}
            {/* A still date: the text face with tabular figures, not mono (DESIGN "Typography", M3). */}
            <time dateTime={new Date(style.updatedAt).toISOString()} className="font-sans tabular-nums">
              {formatDay(i18n, style.updatedAt)}
            </time>
          </span>
        </span>
      }
      action={<Link to="/settings/brand/$styleId" params={{ styleId: style.id }} data-slot="brand-kit-row" />}
    />
  );
}

/** The page's frame: its name, its line, and New brand kit in the window bar once there is a list. */
function BrandFrame({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  const { t } = useLingui();
  return (
    <SettingsPage
      title={t`Brand kits`}
      description={
        <Trans>Your colours, fonts, logo and caption look, put on any video or template in one step.</Trans>
      }
      {...(actions ? { actions } : {})}
    >
      {children}
    </SettingsPage>
  );
}

export function BrandKitsPage() {
  const { t } = useLingui();
  const styles = useStyles();
  const kit = useNewKit();
  const items = styles.data;
  if (styles.error && !items)
    return (
      <BrandFrame>
        <LoadError
          error={styles.error}
          onRetry={styles.reload}
          what={<Trans>Brand kits didn’t load.</Trans>}
        />
      </BrandFrame>
    );
  if (!items)
    return (
      <BrandFrame>
        <Skeleton name="settings-brand" loading fixture={<BrandBones />}>
          {null}
        </Skeleton>
      </BrandFrame>
    );
  const newButton = (
    <Button
      variant="primary"
      size={items.length === 0 ? 'md' : 'sm'}
      icon={VERB_ICONS.add}
      loading={kit.pending}
      onClick={() => void kit.create()}
    >
      {t`New brand kit`}
    </Button>
  );
  if (items.length === 0)
    return (
      <BrandFrame>
        <EmptyState
          icon={SETTINGS_ICONS.brandKits}
          title={<Trans>No brand kits yet</Trans>}
          description={
            <Trans>
              A brand kit is your colours, fonts, logo and caption look. Make one, then put it on any video or
              template in one step.
            </Trans>
          }
          action={newButton}
        />
      </BrandFrame>
    );
  const kits = items.filter((style) => style.kind === 'brandKit');
  const looks = items.filter((style) => style.kind === 'look');
  // The same Skeleton as while loading: one instance from loading to loaded.
  return (
    <BrandFrame actions={newButton}>
      <Skeleton name="settings-brand" loading={false} fixture={<BrandBones />}>
        <Arrival animate>
          <div className="flex flex-col gap-10 [&>[data-slot=page-section]]:mt-0!">
            <PageSection icon={SETTINGS_ICONS.brandKits} title={t`Your brand kits`}>
              {kits.length === 0 ? (
                <p className="m-0 type-body text-ink-2">{t`None yet: New brand kit makes one.`}</p>
              ) : (
                <SettingRows aria-label={t`Brand kits`}>
                  {kits.map((style) => (
                    <KitRow key={style.id} style={style} />
                  ))}
                </SettingRows>
              )}
            </PageSection>
            {looks.length > 0 ? (
              <PageSection
                icon={SETTINGS_ICONS.colours}
                title={t`Looks`}
                description={t`Measured from a reference or a template: a colour grade and the closest font.`}
              >
                <SettingRows aria-label={t`Looks`}>
                  {looks.map((style) => (
                    <KitRow key={style.id} style={style} />
                  ))}
                </SettingRows>
              </PageSection>
            ) : null}
          </div>
        </Arrival>
      </Skeleton>
    </BrandFrame>
  );
}
