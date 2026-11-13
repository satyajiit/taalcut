// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The renderer's fake backend (renderer dev and e2e) copies tables the engine owns: the renderer may import only
 * core and ui, so it can't read them. This repo-level test is the one place both sides can be imported (the
 * dependency rules don't scan scripts/), and it fails when a copy drifts from the engine's table.
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATE_FORMATS } from '../../apps/renderer/src/backend/fake/templates/template-formats.ts';
import { PRESETS } from '../../apps/renderer/src/backend/fake/make/render-presets.ts';
import { EXPORT_PRESETS } from '../../packages/render/src/presets/presets.v1.ts';
import { FORMAT_SUMMARIES } from '../../packages/templates/src/formats/registry.ts';

describe('the renderer fakes answer with the engine tables', () => {
  it("templates.formats: the fake lists the templates service's eight formats, value for value", () => {
    expect(TEMPLATE_FORMATS).toEqual(FORMAT_SUMMARIES);
  });

  it("export presets: the fake's table is render's EXPORT_PRESETS, in the dialog's order", () => {
    expect(PRESETS).toEqual(EXPORT_PRESETS);
  });
});
