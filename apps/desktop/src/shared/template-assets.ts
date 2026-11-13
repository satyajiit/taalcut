// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the template and Style stores keep their assets (contact sheets,
 * logos), agreed between the utility processes (which write them through the
 * library's TemplateStore and StyleStore) and main (which serves them on
 * app://media/templates/… and app://media/styles/…).
 * No Electron and no Node beyond path.
 */
import { join } from 'node:path';

/**
 * `<userData>/templates`: the template stores' root. REF1: each template's kept reel is in `media/<template id>/`
 * under it (the library's templateMediaFolder(templatesRoot, id)).
 */
export const templatesRoot = (userData: string): string => join(userData, 'templates');

/** Template contact sheets and other template assets, content-addressed (the template store's files). */
export const templateAssetsDir = (userData: string): string => join(userData, 'templates', 'assets');

/** Style logos, content-addressed (the Style store's files). */
export const styleAssetsDir = (userData: string): string => join(userData, 'styles', 'assets');
