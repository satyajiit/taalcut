// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: what shot the clip, and when, where it was shot (LIB1-OEM) · mode: Operate · system: DESIGN.md v0.7
 *   (ListRow, the icon registry, type roles)
 * two rows of the facts card's When and where group:
 *   the camera: the phone's name as its file gives it ("Samsung Galaxy Example"), with Samsung's model number or
 *     the lens Apple names under it, and the phone's own name for its capture mode as a mark ("Time-lapse"); a file
 *     an app wrote says so on its own ("From the Sample Cam app"): the device code the app writes beside its name is
 *     its internal code, never shown (capture-words.ts, cameraWords). Makers' names are shown as written
 *   the time: the day and time in the zone it was shot in, with one sentence under it: "Filmed at GMT+2" (the zone
 *     named by Intl), "Filmed probably at GMT+2, like the clips around it" when the zone was borrowed from the clips
 *     shot around it, "Filmed, shown in your time zone" when nothing says
 * states: camera known · app only · neither (no row) · zone from the file · zone borrowed · no zone · no capture time
 *   (the day it was added) · photo ("Taken") · rows: static (no hover, no focus)
 * motion: none of its own (the inspector's cascade brings it in)
 * contrast: values ink ≥ 7:1, qualifiers ink-2 ≥ 7:1; the camera glyph is labelled by its words */
import { Trans, useLingui } from '@lingui/react/macro';
import type { AssetDetail } from '@taalcut/core';
import { CONCEPT_ICONS, UserContent } from '@taalcut/ui';
import { Camera } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDay } from '../../../shared/format';
import { cameraWords, captureDateTime, zoneName } from './capture-words';
import { Fact, Mark } from './fact-row';

/** A row's qualifiers, split by a middot only the eye reads. */
function Qualifiers({ parts }: { parts: readonly ReactNode[] }) {
  return (
    <span className="flex flex-wrap gap-x-1.5">
      {parts.map((part, i) => (
        <span key={i} className="contents">
          {i > 0 ? <span aria-hidden>·</span> : null}
          {part}
        </span>
      ))}
    </span>
  );
}

export function ClipCamera({ detail }: { detail: AssetDetail }) {
  const words = cameraWords(detail.facts?.device);
  if (!words) return null;
  const { camera, app, detail: more } = words;
  const mode = detail.facts?.captureMode;
  const parts = [
    more ? (
      <UserContent key="more" translate="no">
        {more}
      </UserContent>
    ) : null,
    camera && app ? (
      <span key="app">
        <Trans>
          Through the <UserContent translate="no">{app}</UserContent> app
        </Trans>
      </span>
    ) : null,
  ].filter(Boolean);
  return (
    <Fact
      leading={Camera}
      title={
        camera ? (
          <UserContent translate="no">{camera}</UserContent>
        ) : (
          <Trans>
            From the <UserContent translate="no">{app}</UserContent> app
          </Trans>
        )
      }
      meta={parts.length > 0 ? <Qualifiers parts={parts} /> : undefined}
    >
      {mode ? (
        <span className="flex flex-wrap items-center gap-1.5 pt-1">
          <Mark>
            <span translate="no">{mode}</span>
          </Mark>
        </span>
      ) : null}
    </Fact>
  );
}

/** A zone's name: Intl's words, not the catalogue's. */
function Zone({ children }: { children: ReactNode }) {
  return (
    <span translate="no" className="tabular-nums">
      {children}
    </span>
  );
}

/** How it was dated, in one sentence: where its zone came from, or that none did. */
function WhenWords({ detail }: { detail: AssetDetail }) {
  const { t, i18n } = useLingui();
  const { asset } = detail;
  const at = asset.capturedAt;
  const offset = asset.captureOffset ?? null;
  const photo = asset.kind === 'image';
  if (at === null) return t`Added to Taalcut`;
  if (!offset) return photo ? t`Taken, shown in your time zone` : t`Filmed, shown in your time zone`;
  const zone = zoneName(i18n, at, offset.minutes);
  if (offset.from === 'file')
    return photo ? (
      <Trans>
        Taken at <Zone>{zone}</Zone>
      </Trans>
    ) : (
      <Trans>
        Filmed at <Zone>{zone}</Zone>
      </Trans>
    );
  return photo ? (
    <Trans>
      Taken probably at <Zone>{zone}</Zone>, like the clips around it
    </Trans>
  ) : (
    <Trans>
      Filmed probably at <Zone>{zone}</Zone>, like the clips around it
    </Trans>
  );
}

export function ClipWhen({ detail }: { detail: AssetDetail }) {
  const { i18n } = useLingui();
  const { asset } = detail;
  const at = asset.capturedAt;
  return (
    <Fact
      leading={CONCEPT_ICONS.date}
      title={
        <time dateTime={new Date(at ?? asset.addedAt).toISOString()}>
          {at !== null ? captureDateTime(i18n, at, asset.captureOffset) : formatDay(i18n, asset.addedAt)}
        </time>
      }
      meta={<WhenWords detail={detail} />}
    />
  );
}
