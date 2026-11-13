// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page: the brand kit editor (/settings/brand/$styleId, P3-V10, UX4) · genre: atmospheric studio app
 *   (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * the layout of the kit's five views (brand-kit-views.tsx): the bar's "Brand kits › <name>" with the kit's actions,
 *   the views, then two columns: down the left, the save status, the kit's name and the open view's sections, each
 *   field saving once when the person is done with it, each save one ⌘Z; on the right, the 9:16 preview on the
 *   viewer grey, kept in view and beside every view (on Intro and outro it opens on the intro). The editor's state
 *   is made here, once per kit, and shared with the view through context, so moving between views keeps it.
 * states: loading (the named skeleton: the sections and the 9:16 preview) · gone (deleted elsewhere: one line;
 *   the bar's "Brand kits ›" goes up) · error (the cause, Try again) · editing · saving (the status line says so,
 *   politely) · saved ("Saved. ⌘Z undoes it.") · refused (the reason under its section, assertive) · changed
 *   elsewhere (reloads, says so) · a look (its grade in words)
 */
import { useLingui } from '@lingui/react/macro';
import type { StyleId } from '@taalcut/core';
import { PageSection, Skeleton, UserContent, useShortcutFormat, type IconLike } from '@taalcut/ui';
import { Outlet } from '@tanstack/react-router';
import { createContext, useContext, type ReactNode } from 'react';
import { UNDO_SHORTCUT } from '../make/use-undoable';
import { LoadError, Notice } from '../settings/fields';
import { SettingsPage } from '../settings/settings-page';
import { EditorBones } from './brand-bones';
import { BrandActions } from './brand-actions';
import { BrandKitViews, type BrandViewId } from './brand-kit-views';
import { BrandPreview } from './brand-preview';
import { CommitInput } from './commit-fields';
import { useStyles } from './use-styles';
import { useStyleEditor, type StyleEditor } from './use-style-editor';

/** The open kit's editor, loaded: what a view edits. */
export type LoadedEditor = StyleEditor & { style: NonNullable<StyleEditor['style']> };

const EditorContext = createContext<LoadedEditor | null>(null);

/** The open kit's editor, for a view under the editor's layout. */
export function useBrandEditor(): LoadedEditor {
  const editor = useContext(EditorContext);
  // A view only renders inside the layout once the kit has loaded: anything else is a bug.
  if (!editor) throw new Error('useBrandEditor outside the brand kit editor');
  return editor;
}

/** A section of a view, with the refusal of a field inside it under its controls. */
export function Part(props: {
  title: string;
  icon: IconLike;
  description?: string;
  fields: readonly string[];
  children: ReactNode;
}) {
  const { status } = useBrandEditor();
  const failed = status?.state === 'failed' && props.fields.some((field) => status.field.startsWith(field));
  return (
    <PageSection
      icon={props.icon}
      title={props.title}
      {...(props.description ? { description: props.description } : {})}
    >
      {props.children}
      {failed && status.message ? (
        <Notice tone="danger" role="alert">
          {status.message}
        </Notice>
      ) : null}
    </PageSection>
  );
}

/** The kit's name, and what a look is, above every view. */
function NameField({ editor }: { editor: LoadedEditor }) {
  const { t, i18n } = useLingui();
  const { style, status } = editor;
  const strength = style.grade ? i18n.number(style.grade.strength, { style: 'percent' }) : null;
  return (
    <div className="flex flex-col gap-3" data-slot="brand-name">
      <CommitInput
        label={t`Name`}
        value={style.name}
        maxLength={80}
        userContent
        validate={(name) => (name.trim() ? null : t`Give the kit a name.`)}
        onCommit={(name) => editor.commit('name', () => ({ name: name.trim() }))}
      />
      {style.grade && strength ? (
        <p className="m-0 max-w-prose type-body text-ink-2">
          {t`This look grades footage towards colours measured from a reference, at ${strength} strength.`}
        </p>
      ) : null}
      {status?.state === 'failed' && status.field === 'name' && status.message ? (
        <Notice tone="danger" role="alert">
          {status.message}
        </Notice>
      ) : null}
    </div>
  );
}

export function BrandKitEditor({ styleId, view }: { styleId: StyleId; view: BrandViewId }) {
  const { t } = useLingui();
  const undoKeys = useShortcutFormat().text(UNDO_SHORTCUT);
  const editor = useStyleEditor(styleId);
  const styles = useStyles();
  const { style, status, query } = editor;
  if (!style) {
    const gone = query.error?.code === 'templates.style_not_found';
    return (
      <SettingsPage title={t`Brand kits`}>
        {/* No back link in the content: the bar's "Brand kits ›", Back and ⌘[ go up (DESIGN "Window", v0.4). */}
        {query.error && gone ? (
          <p className="m-0 type-prose text-ink-2">{t`This brand kit is gone. It may have been deleted.`}</p>
        ) : query.error ? (
          <LoadError error={query.error} onRetry={query.reload} what={t`This brand kit didn’t load.`} />
        ) : (
          <Skeleton name="settings-brand-kit" loading fixture={<EditorBones />}>
            {null}
          </Skeleton>
        )}
      </SettingsPage>
    );
  }
  const loaded: LoadedEditor = { ...editor, style };
  const isDefault = styles.data?.find((item) => item.id === styleId)?.isDefault ?? false;
  return (
    <SettingsPage
      title={t`Brand kits`}
      detail={<UserContent translate="no">{style.name}</UserContent>}
      actions={<BrandActions kit={{ id: style.id, name: style.name, kind: style.kind, isDefault }} />}
      views={<BrandKitViews styleId={styleId} current={view} />}
    >
      {/* The same Skeleton as while loading: one instance from loading to loaded. */}
      <Skeleton name="settings-brand-kit" loading={false} fixture={<EditorBones />}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 flex-col gap-10 [&>[data-slot=page-section]]:mt-0!">
            <div className="flex flex-col gap-4">
              <p aria-live="polite" className="m-0 min-h-5 type-meta text-ink-3" data-slot="brand-status">
                {status?.state === 'saving'
                  ? t`Saving…`
                  : status?.state === 'saved'
                    ? t`Saved. ${undoKeys} undoes it.`
                    : null}
              </p>
              <NameField editor={loaded} />
            </div>
            <EditorContext.Provider value={loaded}>
              <Outlet />
            </EditorContext.Provider>
          </div>
          <aside aria-label={t`Preview`} className="self-start lg:sticky lg:top-6">
            {/* On Intro and outro the preview opens on the intro; elsewhere on the video. */}
            <BrandPreview
              key={view === 'intro-outro' ? 'intro' : 'video'}
              style={style}
              opensOn={view === 'intro-outro' ? 'intro' : 'video'}
            />
          </aside>
        </div>
      </Skeleton>
    </SettingsPage>
  );
}
