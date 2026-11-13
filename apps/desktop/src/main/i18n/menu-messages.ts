// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every label of the native menu. Plain descriptors (main has no Lingui
 * macros); the i18n comment is what `lingui extract` looks for. The app's
 * name is a product name and is never translated.
 */
import type { MessageDescriptor } from '@lingui/core';

/** The Go items, Settings… and Toggle Sidebar, by the name of the UI command they run (core's createUiCommands). */
export const NAVIGATION_LABELS: Readonly<Record<string, MessageDescriptor>> = {
  'go.make': /*i18n*/ { id: 'menu.go.make', message: 'Make' },
  'go.library': /*i18n*/ { id: 'menu.go.library', message: 'Library' },
  'go.templates': /*i18n*/ { id: 'menu.go.templates', message: 'Templates' },
  'go.agent': /*i18n*/ { id: 'menu.go.agent', message: 'Agent' },
  'go.settings': /*i18n*/ { id: 'menu.app.settings', message: 'Settings…' },
  'view.sidebar': /*i18n*/ { id: 'menu.view.sidebar', message: 'Toggle Sidebar' },
};

export const MENU_LABELS = {
  about: /*i18n*/ { id: 'menu.app.about', message: 'About {appName}' },
  services: /*i18n*/ { id: 'menu.app.services', message: 'Services' },
  hide: /*i18n*/ { id: 'menu.app.hide', message: 'Hide {appName}' },
  hideOthers: /*i18n*/ { id: 'menu.app.hideOthers', message: 'Hide Others' },
  unhide: /*i18n*/ { id: 'menu.app.showAll', message: 'Show All' },
  quit: /*i18n*/ { id: 'menu.app.quit', message: 'Quit {appName}' },
  // Linux and Windows have no menu under the app's name: Settings… and Quit are under File.
  file: /*i18n*/ { id: 'menu.file', message: 'File' },
  edit: /*i18n*/ { id: 'menu.edit', message: 'Edit' },
  undo: /*i18n*/ { id: 'menu.edit.undo', message: 'Undo' },
  redo: /*i18n*/ { id: 'menu.edit.redo', message: 'Redo' },
  cut: /*i18n*/ { id: 'menu.edit.cut', message: 'Cut' },
  copy: /*i18n*/ { id: 'menu.edit.copy', message: 'Copy' },
  paste: /*i18n*/ { id: 'menu.edit.paste', message: 'Paste' },
  pasteAndMatchStyle: /*i18n*/ { id: 'menu.edit.pasteAndMatchStyle', message: 'Paste and Match Style' },
  delete: /*i18n*/ { id: 'menu.edit.delete', message: 'Delete' },
  selectAll: /*i18n*/ { id: 'menu.edit.selectAll', message: 'Select All' },
  view: /*i18n*/ { id: 'menu.view', message: 'View' },
  reload: /*i18n*/ { id: 'menu.view.reload', message: 'Reload' },
  toggleDevTools: /*i18n*/ { id: 'menu.view.toggleDevTools', message: 'Toggle Developer Tools' },
  resetZoom: /*i18n*/ { id: 'menu.view.resetZoom', message: 'Actual Size' },
  zoomIn: /*i18n*/ { id: 'menu.view.zoomIn', message: 'Zoom In' },
  zoomOut: /*i18n*/ { id: 'menu.view.zoomOut', message: 'Zoom Out' },
  togglefullscreen: /*i18n*/ { id: 'menu.view.fullScreen', message: 'Toggle Full Screen' },
  go: /*i18n*/ { id: 'menu.go', message: 'Go' },
  window: /*i18n*/ { id: 'menu.window', message: 'Window' },
  minimize: /*i18n*/ { id: 'menu.window.minimize', message: 'Minimize' },
  zoom: /*i18n*/ { id: 'menu.window.zoom', message: 'Zoom' },
  close: /*i18n*/ { id: 'menu.window.close', message: 'Close Window' },
  front: /*i18n*/ { id: 'menu.window.front', message: 'Bring All to Front' },
} as const satisfies Record<string, MessageDescriptor>;
