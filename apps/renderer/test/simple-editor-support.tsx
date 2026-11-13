// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { ok, simpleEditorPayloads, type Timeline } from '@taalcut/core';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { seedProjects } from '../src/backend/fake/make/seed';
import { buildModel } from '../src/features/timeline/model';
import { createPlayhead } from '../src/features/timeline/playhead';
import type { Edits } from '../src/features/timeline/use-edits';

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
export function EditorTestProvider({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
export const mountEditorControl = (children: ReactNode) => render(children, { wrapper: EditorTestProvider });

export function editorFixture() {
  const timeline = structuredClone(
    seedProjects().projects.flatMap((project) => project.timelines)[0]!,
  ) as Timeline;
  const model = buildModel(timeline, null);
  const playhead = createPlayhead();
  playhead.setFilm(model.total, model.rate.num / model.rate.den);
  const seek = vi.spyOn(playhead, 'seek');
  const pause = vi.spyOn(playhead, 'pause');
  const play = vi.spyOn(playhead, 'play');
  const command = vi.fn<Edits['command']>(async (name, payload) => {
    // UI payloads must satisfy the same contract the AI tool and queue admit.
    const schema = simpleEditorPayloads[name as keyof typeof simpleEditorPayloads];
    schema?.parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      revision: timeline.revision,
      ...payload,
    });
    return ok({});
  });
  const edits: Edits = {
    command,
    pending: false,
    error: null,
    clearError: vi.fn(),
    trim: vi.fn(async () => ok(null)),
    move: vi.fn(async () => ok(null)),
    swap: vi.fn(async () => ok(null)),
    lock: vi.fn(async () => ok(null)),
    editText: vi.fn(async () => ok(null)),
  };
  return { timeline, model, playhead, seek, pause, play, edits, command };
}
