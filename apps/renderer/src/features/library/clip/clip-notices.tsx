// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: what stands between you and the clip · genre: atmospheric studio app · system: DESIGN.md v0.4
 * one line each, under the viewer, an icon and a plain sentence that says what to do next, its one fix beside it:
 *   removed (Put it back), the original's drive away (connect it: the page follows by itself), the original gone
 *   (Look again in its folder: a scan finds a file moved or renamed inside it), only in iCloud, a smaller copy
 *   from the phone. Warnings are yellow icons with ink words: colour is never the only signal
 * states (each fix): the Button's own: default · hover · focus · active · loading (while the command runs) ·
 *   error (the cause in one line, the button again) · success (silent: the line changes to say what happens next)
 *   · disabled n/a
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { Trans, useLingui } from '@lingui/react/macro';
import { LIBRARY_COMMANDS, type AssetDetail, type TaalcutError } from '@taalcut/core';
import { Button, ErrorLine, UserContent } from '@taalcut/ui';
import { Cloud, FileQuestion, HardDrive, LoaderCircle, Smartphone, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useCommand } from '../../../backend/use-command';

function Notice({ icon, children, fix }: { icon: ReactNode; children: ReactNode; fix?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="m-0 flex max-w-[65ch] min-w-0 flex-1 basis-80 items-start gap-2 text-sm text-ink">
        {icon}
        <span>{children}</span>
      </p>
      {fix}
    </li>
  );
}

type Fix = 'restore' | 'rescan';

export function ClipNotices({ detail }: { detail: AssetDetail }) {
  const { t } = useLingui();
  const command = useCommand({ toast: false });
  const [busy, setBusy] = useState<Fix | null>(null);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const { asset } = detail;
  const location = detail.locations[0];
  const source = location ? <UserContent translate="no">{location.sourceName}</UserContent> : null;
  const drive = location?.volumeName ?? location?.sourceName;

  const run = async (fix: Fix, name: string, payload: unknown) => {
    setBusy(fix);
    const result = await command.run({ name, payload });
    setBusy(null);
    setError(result.ok ? null : result.error);
    if (result.ok && fix === 'rescan') setLooking(true);
  };

  const notices: ReactNode[] = [];
  if (asset.trashed)
    notices.push(
      <Notice
        key="trashed"
        icon={<Trash2 aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />}
        fix={
          <Button
            size="sm"
            loading={busy === 'restore'}
            onClick={() => void run('restore', LIBRARY_COMMANDS.restoreAssets, { assetIds: [asset.id] })}
          >
            {t`Put it back`}
          </Button>
        }
      >
        {t`You removed this clip from your library. It isn’t offered for videos or search.`}
      </Notice>,
    );
  if (location?.state === 'offline')
    notices.push(
      <Notice
        key="offline"
        icon={<HardDrive aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />}
      >
        <Trans>
          The original is on <UserContent translate="no">{drive}</UserContent>, which isn’t connected. Connect
          it to play or export this clip.
        </Trans>
      </Notice>,
    );
  if (location?.state === 'missing')
    notices.push(
      <Notice
        key="missing"
        icon={<FileQuestion aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />}
        fix={
          location.storage === 'referenced' && !looking ? (
            <Button
              size="sm"
              loading={busy === 'rescan'}
              onClick={() =>
                void run('rescan', LIBRARY_COMMANDS.rescanSource, { sourceId: location.sourceId })
              }
            >
              {t`Look again`}
            </Button>
          ) : null
        }
      >
        {looking ? (
          <span className="inline-flex items-start gap-1.5">
            <LoaderCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 animate-spin text-ink-2" />
            <Trans>
              Taalcut is looking through {source}. If the file is still in it, this clip comes back by itself.
            </Trans>
          </span>
        ) : location.storage === 'referenced' ? (
          <Trans>
            Taalcut can’t find the original in {source} any more. If you moved or renamed it inside the
            folder, look again.
          </Trans>
        ) : (
          <Trans>
            The original isn’t in Taalcut’s library folder any more. Import it again from {source}, or remove
            this clip.
          </Trans>
        )}
      </Notice>,
    );
  if (location?.state === 'icloud_placeholder')
    notices.push(
      <Notice
        key="icloud"
        icon={<Cloud aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />}
      >
        {t`The original is in iCloud and isn’t on this Mac yet. Download it in Finder to play or export this clip.`}
      </Notice>,
    );
  if (asset.reencode === 'likely')
    notices.push(
      <Notice
        key="smaller"
        icon={<Smartphone aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />}
      >
        {t`Your iPhone sent a smaller copy of this video. For the original, send it again from the Files app.`}
      </Notice>,
    );

  if (notices.length === 0) return null;
  return (
    <div data-slot="clip-notices" className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">{notices}</ul>
      {error ? <ErrorLine error={error} /> : null}
    </div>
  );
}
