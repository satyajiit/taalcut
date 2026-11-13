// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans, useLingui } from '@lingui/react/macro';
import type { ImportMethod } from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Page } from '../../../shell/page';
import { METHOD_NAMES } from './import-words';
import { HelpView } from '../phone/help/help-view';

export function ImportHelp({ method }: { method: ImportMethod }) {
  const { t, i18n } = useLingui();
  return (
    <Page title={t`Import help`} detail={i18n._(METHOD_NAMES[method])} width="reading">
      {method === 'phone-wifi' || method === 'phone-cable' ? <HelpView /> : null}
      <section className="flex flex-col gap-3">
        <h2 className="m-0 type-section">{t`Connect the source`}</h2>
        <p className="m-0 type-prose text-ink-2">
          {method === 'phone-wifi'
            ? t`Keep both devices on the same Wi-Fi. Turn off a VPN or guest-network isolation if the phone cannot reach this computer. Keep the phone’s browser open while it sends.`
            : method === 'phone-cable'
              ? t`Unlock the phone and use a cable that carries data. On iPhone, tap Trust. On Android, choose File transfer. Reconnect after changing the setting.`
              : method === 'photos'
                ? t`Connect to grant Taalcut read access to your System Photo Library. If access was denied, allow Photos access in System Settings, then connect again. Taalcut never changes your Photos library.`
                : ['camera', 'dji', 'insta360'].includes(method)
                  ? t`Use a card reader or the camera’s USB storage mode. The volume must appear in Finder. Camera Wi-Fi transfer is not supported. Keep all folders, segments and companions together.`
                  : t`Choose files or a folder this computer can read. If a drive is disconnected, reconnect it first. For a moved folder, open its source details and relink it.`}
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="m-0 type-section">{t`Recover an interrupted import`}</h2>
        <p className="m-0 type-prose text-ink-2">
          <Trans>
            Open Imports to see what arrived and what still needs attention. Completed copies stay in your
            library. Reconnect the same source, restore permission or free destination space, then retry
            unfinished files. Some connections restart the current file instead of resuming its bytes.
          </Trans>
        </p>
      </section>
      {method === 'photos' ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 type-section">{t`Originals stored in iCloud`}</h2>
          <p className="m-0 type-prose text-ink-2">
            <Trans>
              Network access is off by default, including previews. Select a batch and enable Download
              selected originals from iCloud on Review. Local only mode keeps downloads off. Photos edits are
              not included.
            </Trans>
          </p>
        </section>
      ) : null}
      {method === 'insta360' || method === 'dji' ? (
        <section className="flex flex-col gap-3">
          <h2 className="m-0 type-section">{t`Saved originals and editable clips`}</h2>
          <p className="m-0 type-prose text-ink-2">
            <Trans>
              Playable MP4 footage enters the clip library. Camera formats that need vendor processing are
              kept as archived captures, with their required originals. 360 stitching and reframing are not
              included. Keep the originals together to repair an incomplete capture later.
            </Trans>
          </p>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="primary">
          <Link to="/library/import/$method" params={{ method }}>{t`Back to connection`}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/library/imports">{t`Open Imports`}</Link>
        </Button>
      </div>
    </Page>
  );
}
