// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The preload script. It runs sandboxed, so it is bundled into one CommonJS
 * file and may only require 'electron'. Every API the renderer gets is
 * listed here, and none of them hands out ipcRenderer or a Node object
 * (Electron security checklist 20): window.taalcutRpc (the port to main)
 * and window.taalcutFiles (a dropped file's path).
 */
import { RPC_BRIDGE_KEY } from '@taalcut/core';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { createFilesBridge, FILES_BRIDGE_KEY } from './files-bridge';
import { createRpcBridge, type PageWindow } from './rpc-bridge';

contextBridge.exposeInMainWorld(
  RPC_BRIDGE_KEY,
  createRpcBridge(ipcRenderer, globalThis as unknown as PageWindow),
);
contextBridge.exposeInMainWorld(FILES_BRIDGE_KEY, createFilesBridge(webUtils));
