// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A test's model process (IX2-S2), as the app's out/utility/shot-model.mjs and the eval's child run: served over
 * its IPC channel until released or its parent goes, then it exits. `MODEL_CHILD=transnet` serves the real
 * TransNetV2 (integration/model-process.test.ts), anything else the picture-change stand-in. Run with tsx's
 * loader (`execArgv: ['--import', 'tsx']`) and `serialization: 'advanced'`.
 */
import { ok } from '@taalcut/core';
import { parentProcessPort } from '../../src/cuts/model-channels';
import { serveShotModel, serveTransNet } from '../../src/cuts/model-serve';
import { pictureChangeModel } from '../../src/test-support';

const port = parentProcessPort(process);
const served =
  process.env.MODEL_CHILD === 'transnet'
    ? serveTransNet(port, process.platform)
    : serveShotModel(port, async () => ok(pictureChangeModel()));
void served.then((end) => process.exit(end === 'released' ? 0 : 3));
