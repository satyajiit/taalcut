// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A Style from the store, for the look commands: a missing one is `timeline.style_not_found`, naming it. */
import type { AsyncResult, Style, StyleId, StyleStore } from '@taalcut/core';
import { StyleNotFound } from '../errors';
import { namedNotFound } from '../model/not-found';

export async function readStyle(styles: Pick<StyleStore, 'get'>, styleId: StyleId): AsyncResult<Style> {
  return namedNotFound(await styles.get(styleId), () => StyleNotFound({ styleId }));
}
