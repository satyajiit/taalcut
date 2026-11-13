// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.voiceCapture (windows: the consent card's recording) and voiceCaptureFilesContract (the agent
 * process: a stopped capture's path, once), both over main's capture store. A window gets ids, durations and
 * hashes, never a path.
 */
import { implementContract, unwrapRpc, voiceCaptureContract, voiceCaptureFilesContract } from '@taalcut/core';
import type { RendererContext } from '../rpc/renderer-connections';
import { microphonePermission, type MicrophoneAccess } from './microphone';
import type { VoiceCaptureStore } from './voice-capture-store';

export function voiceCaptureRouter(store: VoiceCaptureStore, microphone: MicrophoneAccess) {
  const os = implementContract(voiceCaptureContract).$context<RendererContext>();
  return os.router({
    permission: os.permission.handler(() => microphonePermission(microphone)),
    start: os.start.handler(async ({ input }) => ({
      captureId: unwrapRpc(await store.start(input)),
    })),
    append: os.append.handler(async ({ input }) => {
      unwrapRpc(await store.append(input));
    }),
    stop: os.stop.handler(async ({ input }) => unwrapRpc(await store.stop(input.captureId))),
    cancel: os.cancel.handler(async ({ input }) => {
      unwrapRpc(await store.cancel(input.captureId));
    }),
  });
}

export function voiceCaptureFilesRouter(store: Pick<VoiceCaptureStore, 'claim'>) {
  const os = implementContract(voiceCaptureFilesContract);
  return os.router({
    claim: os.claim.handler(async ({ input }) =>
      unwrapRpc(await store.claim(input.captureKey, input.projectId)),
    ),
  });
}
