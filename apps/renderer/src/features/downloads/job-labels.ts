// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { ComponentJob } from '@taalcut/core';

/**
 * What each job is called on its row (UX2-DOWNLOADER): the thing Taalcut does with the parts, never the parts'
 * product names, which follow quietly ("Speech · whisper.cpp, Whisper medium Q5_0, Silero VAD").
 */
export const JOB_LABELS: Readonly<Record<ComponentJob, MessageDescriptor>> = {
  speech: msg({ id: 'downloads.job.speech', message: 'Speech' }),
  search: msg({ id: 'downloads.job.search', message: 'Search' }),
  text: msg({ id: 'downloads.job.text', message: 'Text in frames' }),
  shots: msg({ id: 'downloads.job.shots', message: 'Shots' }),
  beats: msg({ id: 'downloads.job.beats', message: 'Beats' }),
  writing: msg({ id: 'downloads.job.writing', message: 'Writing' }),
  titles: msg({ id: 'downloads.job.titles', message: 'Titles' }),
  sounds: msg({ id: 'downloads.job.sounds', message: 'Sound effects' }),
};
