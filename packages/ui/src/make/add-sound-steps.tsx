// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: add the reel's sound in the app (REF1; the music picker's off state) · system:
 *   DESIGN.md v0.7 (Button, Segmented, the icon registry)
 * what to do when the export carries no music: one line on why, the reel's sound as the platform showed it (a
 *   person's words, as written), the reel's link with Copy link, and the app's steps as a numbered list. The steps
 *   are the export's app's; a file saved to this Mac picks the app with a Segmented, Instagram first
 * states: default · Copy link's (default, hover, focus-visible, active, loading while the clipboard answers, success:
 *   "Copied" with the tick for 2.4 s, error: one line to copy the link by hand) · no reel (the line and the steps only)
 * contrast: ink and ink-2 on the dialog's or the page's surface (7:1); the link in ink
 * motion: none of its own (the Segmented's glide; the picker's Collapse opens it) */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { Platform, PlatformSoundSteps } from '@taalcut/core';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '#components/button';
import { Segmented } from '#components/segmented';
import { UserContent } from '../cards/card-frame';
import { VERB_ICONS } from '../icons/concepts';
import { backendText, presetLabel } from './render-words';

/** A step whose key this catalogue doesn't have yet (a newer render than the app's words). */
const ANY_STEP: MessageDescriptor = msg`Add the reel’s sound in the app before you post.`;

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

/** The link without its scheme and trailing slash: what a person reads (the whole link is copied). */
const shown = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

function CopyLink({ url, disabled }: { url: string; disabled: boolean }) {
  const { t } = useLingui();
  const [copy, setCopy] = useState<CopyState>('idle');
  useEffect(() => {
    if (copy !== 'copied') return;
    const timer = setTimeout(() => setCopy('idle'), 2400);
    return () => clearTimeout(timer);
  }, [copy]);
  const run = async () => {
    setCopy('copying');
    try {
      await navigator.clipboard.writeText(url);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={copy === 'copied' ? Check : VERB_ICONS.copyLink}
        loading={copy === 'copying'}
        disabled={disabled}
        onClick={() => void run()}
      >
        {copy === 'copied' ? t`Copied` : t`Copy link`}
      </Button>
      {copy === 'failed' ? (
        <span role="alert" className="basis-full type-meta text-ink-2">
          {t`Couldn’t reach the clipboard. Select the link and copy it yourself.`}
        </span>
      ) : null}
    </>
  );
}

export interface AddSoundStepsProps {
  readonly steps: PlatformSoundSteps | null;
  /** The export's app; null for a file saved to this Mac (its app is picked here). */
  readonly platform: Platform | null;
  readonly disabled?: boolean;
}

export function AddSoundSteps({ steps, platform, disabled = false }: AddSoundStepsProps) {
  const { t, i18n } = useLingui();
  const apps = steps?.steps.map((each) => each.platform) ?? [];
  const [picked, setPicked] = useState<Platform | null>(null);
  const app = platform && apps.includes(platform) ? platform : (picked ?? apps[0] ?? null);
  const lines = steps?.steps.find((each) => each.platform === app)?.stepKeys ?? [];
  const label = steps?.soundLabel ?? null;
  const url = steps?.referenceUrl ?? null;
  const appName = app ? presetLabel(i18n, app) : '';

  return (
    <section
      aria-label={t`Add the sound in the app`}
      data-slot="platform-sound-steps"
      className="flex flex-col gap-3 pt-1 pb-3"
    >
      <p className="m-0 max-w-prose type-body text-ink-2">
        {t`No music in the file. Add the reel’s sound in the app when you post, and the platform plays it with your video.`}
      </p>
      {label || url ? (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1">
          {label ? (
            <>
              <dt className="type-label text-ink-2">{t`Sound`}</dt>
              <dd className="m-0 min-w-0 type-body text-ink">
                <UserContent translate="no" dir="auto">
                  {label}
                </UserContent>
              </dd>
            </>
          ) : null}
          {url ? (
            <>
              <dt className="type-label text-ink-2">{t`Reel`}</dt>
              <dd className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className="min-w-0 truncate type-body text-ink select-all"
                  dir="ltr"
                  translate="no"
                  title={url}
                >
                  {shown(url)}
                </span>
                <CopyLink url={url} disabled={disabled} />
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {app ? (
        <div className="flex flex-col gap-2">
          {platform && apps.includes(platform) ? (
            <p className="m-0 type-label text-ink">{t`In ${appName}`}</p>
          ) : apps.length > 1 ? (
            <Segmented
              label={t`Steps for`}
              value={app}
              onChange={setPicked}
              disabled={disabled}
              options={apps.map((each) => ({ value: each, label: presetLabel(i18n, each) }))}
            />
          ) : null}
          <ol className="m-0 flex max-w-prose list-decimal flex-col gap-1 ps-5 type-body text-ink marker:text-ink-3 marker:tabular-nums">
            {lines.map((key) => (
              <li key={key}>{backendText(i18n, key, ANY_STEP)}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
