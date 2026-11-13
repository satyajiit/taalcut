// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shot-boundary model's utility process (out/utility/shot-model.mjs, IX2-S2): TransNetV2 with a GPU device of
 * its own, so its windows never hold the jobs thread, on the devices the jobs process's probe names in the open
 * message (LNX1: CUDA on its device, WebGPU, the CPU; without them, this platform's row). Main forks it when the
 * jobs process asks and sends SHOT_MODEL_IPC.connect with the port to the jobs process; it serves vision's model
 * protocol on that port until the jobs process releases it (its idle exit) or goes away (the port closes), then
 * exits. It opens no video and holds no VideoToolbox session. Logic: serve-shot-model.ts.
 */
import { hostPlatformName } from '../platform/names';
import { disableOrtTelemetry } from '../shared/ort-telemetry';
import { serveShotModelProcess } from './serve-shot-model';

// Before anything can load ONNX Runtime: its built-in telemetry stays off.
disableOrtTelemetry();
serveShotModelProcess(process.parentPort, {
  platform: hostPlatformName(),
  exit: (code) => process.exit(code),
});
