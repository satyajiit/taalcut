// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which Style a render draws (P3-V10, SPEC P3.5): the timeline's `styleId`, else its template version's, else
 * none. The resolved Style's id and revision join the export's composition hash (its bytes change with it),
 * so a changed brand kit is a new render.
 */
import {
  ok,
  type AsyncResult,
  type Style,
  type StyleId,
  type StyleStore,
  type Timeline,
  type TemplateRef,
} from '@taalcut/core';

export interface StyleSource {
  /** The Style the timeline renders with, or null. */
  styleFor(timeline: Pick<Timeline, 'styleId' | 'template'>): AsyncResult<Style | null>;
  /** A Style asset's file (the logo), for the bundle. */
  assetPath(sha256: string): AsyncResult<string>;
}

export interface StyleSourceDeps {
  readonly styles: Pick<StyleStore, 'get' | 'assetPath'>;
  /** The template version's Style (templates' store), when the timeline names a template. */
  readonly templateStyleId?: (template: TemplateRef) => AsyncResult<StyleId | null>;
}

export function createStyleSource(deps: StyleSourceDeps): StyleSource {
  return {
    async styleFor(timeline) {
      let styleId = timeline.styleId;
      if (!styleId && timeline.template && deps.templateStyleId) {
        const fromTemplate = await deps.templateStyleId(timeline.template);
        if (!fromTemplate.ok) return fromTemplate;
        styleId = fromTemplate.value;
      }
      if (!styleId) return ok(null);
      const style = await deps.styles.get(styleId);
      // A Style deleted from under a timeline renders as none: the export still works.
      if (!style.ok) return style.error.code === 'core.not_found' ? ok(null) : style;
      return ok(style.value);
    },
    assetPath: (sha256) => deps.styles.assetPath(sha256),
  };
}
