// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, chatClientOverRpc, type AppClient } from '@taalcut/core';
import { localStorageAcknowledgementStore, platformFromNavigator } from '@taalcut/ui';
import { appMediaUrls } from '../backend/media';
import { recoveryClientOverRpc } from '../recovery/client';
import { windowClientOverRpc } from '../shell/window-client';
import type { AppServices } from './provider';

/**
 * The services in Electron: core's contracts over the page's one port to main
 * (connectToMain). Main answers recovery itself and forwards chat and
 * commands to the agent process. Acknowledgements stay in the page: a
 * sign-in sends its acknowledgement time to main with the request.
 */
export function createMainServices(client: AppClient): AppServices {
  return {
    chat: chatClientOverRpc(client.chat),
    commands: {
      dispatch: (input) => callRpc(client.commands.dispatch({ ...input, payload: input.payload })),
    },
    acknowledgements: localStorageAcknowledgementStore(),
    recovery: recoveryClientOverRpc(client.recovery),
    window: windowClientOverRpc(client.window),
    media: appMediaUrls,
    // The OS Chromium itself reports: the one place the app's page learns it.
    platform: platformFromNavigator(navigator),
  };
}
