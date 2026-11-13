// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's Phase 3 namespaces and services until their lanes implement them (packages/core SPEC, "Phase 3
 * contract (round P3-1)"): every procedure answers core.not_implemented. Windows: locale (P3-L2) is main's own
 * (locale/locale-host.ts) and voiceCapture (P3-B6) main's voice service (main/voice/), both passed in; mcpSetup is
 * main/mcp's. Utility processes: the agent's voice capture files (main's voice service), the lan process's device keys
 * (P3-B5) and the mcp process's services (its gateway forwarded to the agent, its telemetry to the agent's queue).
 */
import {
  deviceKeysContract,
  forwardTo,
  implementContract,
  localeContract,
  MAIN_SERVICE_CONTRACTS,
  mcpGatewayContract,
  notServedRouter,
  telemetryIngestContract,
  voiceCaptureContract,
  voiceCaptureFilesContract,
  type MainRouters,
} from '@taalcut/core';
import type { SecretStore } from '@taalcut/models';
import type { localeRouter } from '../locale/locale-host';
import type { RendererContext } from '../rpc/renderer-connections';
import type { UtilityHost } from '../rpc/utility-host';
import { deviceKeysRouter } from '../transfer/device-keys';
import { voiceCaptureFilesRouter } from '../voice/voice-capture-router';
import type { VoiceCaptureStore } from '../voice/voice-capture-store';

/** `locale` and `voiceCapture`: main's own (locale/locale-host.ts, voice/voice-capture-router.ts), passed in; not
 * served without them (tests). */
export function mainPhase3Routers(
  served: {
    readonly locale?: ReturnType<typeof localeRouter>;
    readonly voiceCapture?: MainRouters<RendererContext>['voiceCapture'];
  } = {},
) {
  return {
    locale:
      served.locale ?? notServedRouter<typeof localeContract, RendererContext>(localeContract, 'locale'),
    voiceCapture:
      served.voiceCapture ??
      notServedRouter<typeof voiceCaptureContract, RendererContext>(voiceCaptureContract, 'voiceCapture'),
  };
}

/** What main serves the agent process for Phase 3, spread into its services router: the voice capture claim. */
export function agentPhase3Services(captures?: Pick<VoiceCaptureStore, 'claim'>) {
  return {
    voiceCaptureFiles: captures
      ? voiceCaptureFilesRouter(captures)
      : notServedRouter(voiceCaptureFilesContract, 'voiceCaptureFiles'),
  };
}

/** What main serves the lan process for Phase 3 besides telemetry. No store: the procedure stays unserved. */
export function lanPhase3Services(store?: SecretStore) {
  return {
    deviceKeys: store ? deviceKeysRouter(store) : notServedRouter(deviceKeysContract, 'transfer.deviceKeys'),
  };
}

export function mcpServicesRouter(host: Pick<UtilityHost, 'client'>) {
  return implementContract(MAIN_SERVICE_CONTRACTS.mcp).router({
    gateway: forwardTo(mcpGatewayContract, () => host.client('agent').mcpGateway),
    telemetry: forwardTo(telemetryIngestContract, () => host.client('agent').telemetryIngest),
  });
}
