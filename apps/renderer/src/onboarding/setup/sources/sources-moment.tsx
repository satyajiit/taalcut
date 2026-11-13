// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: Your videos, Kaatu's moment (UX4) · genre: atmospheric studio app · system: DESIGN.md "Mascot" (UX4
 *   moments) + _orch/ux4/specs/design-onb.md
 * one Kaatu with one line under the step's heading, saying where your footage has got to: a tip before anything
 *   comes in (an editor's advice: bring plenty), thinking while the folder is read or the phone sends, a grin when the
 *   clips are in (how many, and where), a bashful look when the import stopped (its cause and Try again are in the
 *   import's view under the ways in). The words carry it; Kaatu is decorative, and goes with Show Kaatu off.
 * states: tip · wait (polite status) · success (polite status) · failure (alert)
 */
import { Plural, Trans } from '@lingui/react/macro';
import type { DeviceRun, SourceView } from '@taalcut/core';
import { KaatuMoment, UserContent } from '@taalcut/ui';
import type { SourcesImport } from './sources-import';

/** A name the person wrote, kept as written in every language. */
const Name = ({ children }: { children: string }) => <UserContent translate="no">{children}</UserContent>;

export function SourcesMoment({
  flow,
  sources,
  runs,
  receiving,
}: {
  flow: SourcesImport;
  sources: readonly SourceView[];
  runs: readonly DeviceRun[];
  /** Files arriving over Wi-Fi, from this device (null: not named yet). */
  receiving: { readonly files: number; readonly device: string | null };
}) {
  const { first, imported } = flow;
  const name = first ? sources.find((source) => source.id === first.sourceId)?.name : undefined;
  if (first?.state === 'failed')
    return (
      <KaatuMoment tone="failure">
        {name ? (
          <Trans>
            Taalcut couldn’t bring in <Name>{name}</Name>. The reason and Try again are below.
          </Trans>
        ) : (
          <Trans>Taalcut couldn’t bring in your clips. The reason and Try again are below.</Trans>
        )}
      </KaatuMoment>
    );
  if (first && imported) {
    const count = first.counts.assets;
    return (
      <KaatuMoment tone="success">
        {name ? (
          <Trans>
            <Plural value={count} one="# clip" other="# clips" /> found in <Name>{name}</Name>. Taalcut keeps
            sorting while you go on.
          </Trans>
        ) : (
          <Trans>
            <Plural value={count} one="# clip" other="# clips" /> found. Taalcut keeps sorting while you go
            on.
          </Trans>
        )}
      </KaatuMoment>
    );
  }
  if (first)
    return (
      <KaatuMoment tone="wait">
        {name ? (
          <Trans>
            Reading the clips in <Name>{name}</Name>. You can go on: it carries on without you.
          </Trans>
        ) : (
          <Trans>Reading your clips. You can go on: it carries on without you.</Trans>
        )}
      </KaatuMoment>
    );
  const device = receiving.device;
  if (receiving.files > 0 || runs.some((run) => run.state === 'running'))
    return (
      <KaatuMoment tone="wait">
        {device ? (
          <Trans>
            Clips are arriving from <Name>{device}</Name>. You can go on: they keep coming.
          </Trans>
        ) : (
          <Trans>Clips are arriving from your phone. You can go on: they keep coming.</Trans>
        )}
      </KaatuMoment>
    );
  return (
    <KaatuMoment tone="tip">
      <Trans>
        Bring in plenty. Taalcut picks the shots, so a whole trip or a month of your camera roll is fine.
      </Trans>
    </KaatuMoment>
  );
}
