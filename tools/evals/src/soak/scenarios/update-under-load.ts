// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type SoakMode } from '../result';
import { type SoakApp, type SoakClock, type SoakScenario, type SoakSink } from '../scenario';
import { growthNotApplicable, type SoakRssSample } from '../score';

const UPDATE_BATCH_SIZE = 1;

/**
 * Smoke and full run this once. An import and a render are started and, while both are still in flight, the feed
 * offers the update and the app quits, installs and relaunches. Both must then finish (resumed), and the files
 * imported must survive. Then a forced-failure build and the rollback.
 */
async function runUpdate(app: SoakApp, _clock: SoakClock, sink: SoakSink, _mode: SoakMode): Promise<void> {
  const importing = app.importBatch(UPDATE_BATCH_SIZE);
  const rendering = app.renderOnce();
  await app.offerUpdate();
  const relaunch = await app.quitInstallRelaunch();
  if (!relaunch.resumed) sink.fail('update-not-resumed');
  const batch = await importing;
  for (const asset of batch.hashes) sink.imported(asset);
  const rendered = await rendering;
  if (!rendered.probed) sink.fail(`invalid-render:${rendered.id}`);
  await app.forceFailedBuild();
  const rolled = await app.rollback();
  if (!rolled.restored) sink.fail('rollback-not-restored');
  if (rolled.dataLost) sink.fail('data-lost');
}

export const updateUnderLoadScenario: SoakScenario = {
  id: 'update-under-load',
  hours: 0,
  checks: ['update-resume', 'rollback', 'integrity'],
  run: runUpdate,
  score(_samples: readonly SoakRssSample[], _mode: SoakMode) {
    return growthNotApplicable();
  },
};
