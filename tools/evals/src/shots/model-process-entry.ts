// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `predict:shots`' model process (model-detectors.ts), as the app's out/utility/shot-model.mjs: TransNetV2 served
 * over the IPC channel until released or the parent goes, then it exits. It runs under the parent's tsx loader.
 */
import { parentProcessPort, serveTransNet } from '@taalcut/vision';

void serveTransNet(parentProcessPort(process), process.platform).then((end) =>
  process.exit(end === 'released' ? 0 : 3),
);
