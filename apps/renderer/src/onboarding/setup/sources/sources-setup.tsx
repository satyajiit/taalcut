// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: onboarding, where are your videos (UX4: first run's first step, and the import folded into it) ·
 *   genre: atmospheric studio app · system: DESIGN.md v0.6 + _orch/ux4/specs/design-onb.md
 * Kaatu's moment first, under the heading (sources-moment.tsx: a tip, then thinking while the clips come in, a grin
 *   when they are in); then three ways in as tiles side by side (a folder, the phone over Wi-Fi, the phone with a
 *   cable: source-tiles.tsx, each led by its registry glyph); the chosen one's panel opens under the tiles, full
 *   width on the column's edge, and the tiles stay, so the person can change their mind. Under them, the import's
 *   own view as it runs (sources-import.tsx). The way out, "I'll add videos later", is a quiet text button at the
 *   foot. Continue waits for a folder added, a file arriving or a cable import started; the import carries on.
 *   Above the way out, first run's one question about speech: the languages in your videos (LIB1-LANG,
 *   spoken-languages-question.tsx).
 * states: loading (bones) · error (LoadError) · default · a way open (its own states) · done (the tile says what
 *   came in, announced) · importing · imported · resume (the way chosen last time opens; a cable run shows its
 *   block)
 */
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import type { DeviceImportRunId, DeviceRun, ImportSessionId, OnboardingBranch } from '@taalcut/core';
import {
  Button,
  CONCEPT_ICONS,
  Glyph,
  SkeletonLines,
  UserContent,
  useHostPlatform,
  usePlatformChoice,
  usePlatformFeatures,
} from '@taalcut/ui';
import { useCallback, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery, useRpcStream } from '../../../backend/use-rpc';
import { LoadError } from '../../../features/settings/fields';
import { StepMoment } from '../../step-screen';
import { useStepGate } from '../../step-gate';
import { EmbeddedImport } from '../../../features/library/imports/embedded-import';
import { folderSources } from './folder-source';
import { cableRuns, ImportDetails, useSourcesImport } from './sources-import';
import { SourcesMoment } from './sources-moment';
import { SourceTiles, type SourceTile } from './source-tiles';
import { SpokenLanguagesQuestion } from './spoken-languages-question';
import { WifiSource, type WifiProgress } from './wifi-source';

type SourceWay = Exclude<NonNullable<OnboardingBranch['source']>, 'later'>;

/** A run this window can follow: started here, or unfinished from before. */
function activeRun(runs: readonly DeviceRun[]): DeviceImportRunId | null {
  return runs.find((run) => run.state === 'running' || run.state === 'paused')?.id ?? null;
}

export function SourcesSetup({
  resume,
  onChoose,
  onLater,
}: {
  resume?: OnboardingBranch['source'] | undefined;
  onChoose: (branch: OnboardingBranch) => void;
  /** "I'll add videos later": on to the next step, with nothing coming in. */
  onLater: () => void;
}) {
  const { t } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const onPlatform = usePlatformChoice();
  const { cableImport } = usePlatformFeatures();
  const backend = useBackend();
  const sources = useRpcQuery((signal) => backend.library.sources(undefined, { signal }), [backend]);
  const devices = useRpcStream((signal) => backend.transfer.devices(undefined, { signal }), [backend]);
  const [open, setOpen] = useState<SourceWay | null>(resume && resume !== 'later' ? resume : null);
  const [opened, setOpened] = useState(false);
  const [wifi, setWifi] = useState<WifiProgress>({ device: null, files: 0, done: 0 });
  const [started, setStarted] = useState<{ method: string; id: ImportSessionId } | null>(null);
  const runId = activeRun(devices.data?.runs ?? []);
  const history = useRpcQuery((signal) => backend.imports.history({ limit: 1 }, { signal }), [backend]);
  const importStarted = started !== null || Boolean(history.data?.items.length);
  const runs = cableRuns(devices.data?.runs ?? [], Date.now());
  const folders = folderSources(sources.data ?? []);
  const flow = useSourcesImport();
  const { device, done, files } = wifi;
  const onWifi = useCallback((progress: WifiProgress) => setWifi(progress), []);

  useStepGate(
    folders.length > 0 || wifi.files > 0 || runId !== null || importStarted,
    t`Add a folder or start an import from your phone to carry on.`,
  );
  if (!sources.data) {
    if (sources.error) return <LoadError error={sources.error} onRetry={sources.reload} />;
    return <SkeletonLines lines={3} className="max-w-xl py-2" />;
  }

  const choose = (way: SourceWay | null) => {
    setOpen(way);
    setOpened(true);
    if (way) onChoose({ source: way });
  };
  const ways: SourceTile<SourceWay>[] = [
    {
      id: 'folder',
      title: mac
        ? t({ id: 'onboarding.sources.folder.title', message: 'A folder on this Mac' })
        : t({ id: 'onboarding.sources.folder.title.computer', message: 'A folder on this computer' }),
      line: t`Choose footage, review it, then copy it or keep it in place.`,
      icon: <Glyph icon={CONCEPT_ICONS.folder} size="lg" />,
      ...(folders.length > 0
        ? { done: t`${plural(folders.length, { one: '# folder added', other: '# folders added' })}` }
        : {}),
      panel: <EmbeddedImport method="folder" onStarted={(id) => setStarted({ method: 'folder', id })} />,
    },
    {
      id: 'wifi',
      title: t({ id: 'onboarding.sources.wifi.title', message: 'My phone, over Wi-Fi' }),
      line: t`Scan a code with the phone’s camera. Nothing to install.`,
      icon: <Glyph icon={CONCEPT_ICONS.wifi} size="lg" />,
      // The one place the arrivals show (one span: the row's line is a flex row); the panel only announces them.
      ...(wifi.files > 0
        ? {
            done: device ? (
              <span>
                <Trans>
                  Receiving from <UserContent translate="no">{device}</UserContent> · {done} of {files}
                </Trans>
              </span>
            ) : (
              t`Receiving · ${done} of ${files}`
            ),
          }
        : {}),
      panel: <WifiSource onProgress={onWifi} />,
    },
    {
      id: 'cable',
      title: t({ id: 'onboarding.sources.cable.title', message: 'My phone, with a cable' }),
      // Off a Mac the cable isn't here yet (its panel says what to do instead).
      line: cableImport
        ? t`The quickest way to bring in a lot of clips.`
        : onPlatform({
            mac: '',
            computer: t`Bringing clips in with a cable isn’t on Linux yet`,
            windows: t`Bringing clips in with a cable isn’t on Windows yet`,
          }),
      icon: <Glyph icon={CONCEPT_ICONS.cable} size="lg" />,
      ...(runId || started?.method === 'phone-cable' ? { done: t`Import started` } : {}),
      panel: (
        <EmbeddedImport method="phone-cable" onStarted={(id) => setStarted({ method: 'phone-cable', id })} />
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-8">
      <StepMoment>
        <SourcesMoment flow={flow} sources={sources.data} runs={runs} receiving={wifi} />
      </StepMoment>
      <SourceTiles
        label={t`Ways to bring in videos`}
        ways={ways}
        open={open}
        onOpen={choose}
        animate={opened}
      />
      <ImportDetails flow={flow} sources={sources.data} />
      <SpokenLanguagesQuestion />
      <div className="border-t border-rule-subtle pt-3">
        <Button
          variant="ghost"
          data-action="later"
          className="-ml-4"
          onClick={() => {
            onChoose({ source: 'later' });
            onLater();
          }}
        >
          {t({ id: 'onboarding.sources.later', message: 'I’ll add videos later' })}
        </Button>
      </div>
    </div>
  );
}
