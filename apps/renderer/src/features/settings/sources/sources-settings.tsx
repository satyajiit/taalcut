// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Settings › Sources (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md
 *   v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * the kit's PageSections. Folders on this Mac (Add folder…, the screen's one marigold fill), one SettingRows list of
 *   them; then From your phone as one row that opens Library › From your phone, where the phone's transfers and their
 *   history live (it isn't repeated here); then Also in your library when the library has other sources.
 * states: loading (named skeletons captured from the rows) · empty (the still shape of the list, Kaatu, one line and
 *   Add folder) · error (the cause and Try again) · adding (the button spins while the dialog is open and the folder
 *   is added) · add failed (the cause and its fix under the heading) · cancelled dialog (nothing) · each row's own
 *   states (source-row.tsx) · success (silent: the list re-reads; a removal's toast has Undo)
 * motion: the kit's (the empty state's arrival, the buttons' press); the bones pulse while loading.
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { callRpc, newId, type SourceView } from '@taalcut/core';
import { Button, CONCEPT_ICONS, ErrorLine, PageSection, Skeleton, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useBackend } from '../../../backend/backend';
import { fixCommand } from '../../../backend/fix-command';
import { BoneRows } from '../bones';
import { LoadError } from '../fields';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { SourceRow } from './source-row';
import { SourcesEmpty } from './sources-empty';
import { useSourceActions } from './use-source-actions';
import { useSources } from './use-sources';

const FOLDER_BONES = [
  { title: '22%', lines: ['46%', '30%'], control: 'button', icon: true },
  { title: '30%', lines: ['52%', '26%'], control: 'button', icon: true },
  { title: '18%', lines: ['40%', '34%'], control: 'button', icon: true },
] as const;

const isFolder = (source: SourceView) => source.kind === 'watched_folder';
const isPhone = (source: SourceView) => source.kind === 'wifi_import' || source.kind === 'usb_import';

/**
 * From your phone, as one row: what came from phones lives in Library › From your phone, with each transfer and
 * its history, so Settings only says how much and goes there.
 */
function PhoneRow({ phones }: { phones: readonly SourceView[] }) {
  const clips = phones.reduce((sum, phone) => sum + phone.assets, 0);
  return (
    <SettingRows>
      <SettingRow
        data-slot="sources-phone"
        icon={CONCEPT_ICONS.phone}
        title={
          phones.length > 0 ? (
            <Plural value={clips} one="# clip from your phone" other="# clips from your phone" />
          ) : (
            <Trans>Nothing sent from a phone yet.</Trans>
          )
        }
        description={<Trans>Send clips and see every transfer in the Library.</Trans>}
        action={<Link to="/library/imports" search={{ phones: true }} />}
      />
    </SettingRows>
  );
}

export function SourcesSettings({ now }: { now?: number }) {
  const { t } = useLingui();
  const backend = useBackend();
  const { sources, importOf } = useSources();
  const actions = useSourceActions();
  const list = sources.data;
  const loading = !list && sources.status !== 'error';

  const folders = list?.filter(isFolder) ?? [];
  const phones = list?.filter(isPhone) ?? [];
  const others = list?.filter((source) => !isFolder(source) && !isPhone(source)) ?? [];
  const empty = Boolean(list) && folders.length === 0;
  const rows = (items: readonly SourceView[], label: string) => (
    <SettingRows aria-label={label}>
      {items.map((source) => (
        <SourceRow
          key={source.id}
          source={source}
          running={importOf(source.id)}
          actions={actions}
          {...(now === undefined ? {} : { now })}
        />
      ))}
    </SettingRows>
  );
  const addFolder = (
    <Button variant="primary" icon={VERB_ICONS.addFolder} data-action="add-folder" asChild>
      <Link to="/library/import/$method" params={{ method: 'folder' }}>
        <Trans>Add folder…</Trans>
      </Link>
    </Button>
  );

  return (
    <>
      <PageSection
        icon={CONCEPT_ICONS.folder}
        title={<Trans>Folders on this Mac</Trans>}
        description={
          <Trans>
            Taalcut reads each clip where it is and watches the folder for new ones. Nothing is copied or
            moved.
          </Trans>
        }
        // Empty, the list's own empty state carries Add folder: one button for one action.
        actions={empty ? undefined : addFolder}
      >
        {actions.addError ? (
          <ErrorLine
            key={actions.addError.code}
            error={actions.addError}
            onFix={(fix) =>
              callRpc(
                backend.commands.dispatch({ ...fixCommand(fix), source: 'ui', idempotencyKey: newId() }),
              )
            }
          />
        ) : null}
        <Skeleton name="settings-sources" loading={loading} fixture={<BoneRows rows={FOLDER_BONES} />}>
          {sources.status === 'error' && !list ? (
            <LoadError
              error={sources.error}
              onRetry={sources.reload}
              what={<Trans>Your sources didn’t load.</Trans>}
            />
          ) : list ? (
            empty ? (
              <SourcesEmpty action={addFolder} />
            ) : (
              rows(folders, t`Folders`)
            )
          ) : null}
        </Skeleton>
      </PageSection>

      <PageSection
        icon={CONCEPT_ICONS.phone}
        title={<Trans>From your phone</Trans>}
        description={
          <Trans>
            Clips you sent from your phone over Wi-Fi or a cable. Taalcut keeps a copy in its own folder on
            this Mac.
          </Trans>
        }
      >
        {list ? <PhoneRow phones={phones} /> : null}
      </PageSection>

      {others.length > 0 ? (
        <PageSection
          icon={SETTINGS_ICONS.sources}
          title={<Trans>Also in your library</Trans>}
          description={<Trans>Clips Taalcut fetched or made for your videos.</Trans>}
        >
          {rows(others, t`Other sources`)}
        </PageSection>
      ) : null}
    </>
  );
}
