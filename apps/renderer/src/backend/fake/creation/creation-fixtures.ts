// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- authored fixture content, not application UI */

import {
  DEFAULT_MIX,
  FrameRates,
  newId,
  RationalTime,
  type AuthoredInspection,
  type CreationDraft,
  type CreationProject,
  type Timeline,
} from '@taalcut/core';
import { fakeUlid } from '../library/seed';

export const CREATION_PREVIEW = fakeUlid<'Asset'>(1, 1);
export const CREATION_DEMO = fakeUlid<'Project'>(29, 1);

/** A directly addressable workspace for route/a11y checks; it does not fill the empty project list. */
export function creationDemo(): CreationProject {
  return {
    projectId: CREATION_DEMO,
    revision: 1,
    brief: {
      category: 'product-launch',
      title: 'OpenAlly launch',
      prompt: 'A workspace that answers the next question.',
      audience: 'Product teams',
      callToAction: 'Try OpenAlly',
      formats: ['16:9', '9:16'],
      duration: RationalTime.fromSeconds(30, FrameRates.fps60),
      voice: { mode: 'none', voiceId: null, assetId: null, language: 'en' },
    },
    sources: [],
    draft: null,
    approvedDraftRevision: null,
    status: 'draft',
    tasks: [],
    budget: { capMicros: null, spentMicros: 0, reservedMicros: 0 },
    timelineId: null,
    error: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

export function creationDraft(project: CreationProject): CreationDraft {
  const duration = RationalTime.fromSeconds(
    RationalTime.toSeconds(project.brief.duration) / 3,
    FrameRates.fps60,
  );
  return {
    revision: (project.draft?.revision ?? 0) + 1,
    visualPreviewAssetId: CREATION_PREVIEW,
    title: project.brief.title,
    visualDirection:
      'One continuous camera journey. Large, readable product details. Carry the same object across transitions and finish on the original brand mark.',
    questions: [
      {
        id: 'promise',
        prompt: 'What is the one benefit viewers should remember?',
        required: true,
        answer: null,
      },
    ],
    beats: [
      {
        id: 'hook',
        duration,
        narration: project.brief.prompt,
        screenText: project.brief.title,
        visual: 'Open on one meaningful product detail. The cursor causes each change.',
        transition: 'Carry the product into the demonstration.',
      },
      {
        id: 'proof',
        duration,
        narration: project.brief.audience,
        screenText: 'See it work.',
        visual: 'Show one concrete outcome, at reading size.',
        transition: 'Push through the result into the brand reveal.',
      },
      {
        id: 'close',
        duration,
        narration: project.brief.callToAction,
        screenText: project.brief.callToAction,
        visual: 'Resolve into the original logo and clear next step.',
        transition: 'Hold the final lockup.',
      },
    ],
  };
}

export function creationTimeline(project: CreationProject): {
  timeline: Timeline;
  inspection: AuthoredInspection;
} {
  const aspect = project.brief.formats[0] ?? '16:9';
  const sizes = {
    '16:9': [1920, 1080],
    '9:16': [1080, 1920],
    '1:1': [1080, 1080],
    '4:5': [1080, 1350],
  } as const;
  const [width, height] = sizes[aspect];
  const canvas = { width, height, rate: FrameRates.fps60 };
  const programId = newId<'AuthoredProgram'>();
  const source = `<main id="stage"><h1 id="title">${project.brief.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</h1></main>`;
  const hash = 'a'.repeat(64);
  const program = {
    id: programId,
    hash,
    version: 1,
    entry: 'index.html',
    files: [{ path: 'index.html', sha256: hash, bytes: source.length }],
    canvas,
    duration: project.brief.duration,
    chapters: [],
    assetIds: [],
  };
  const timeline: Timeline = {
    schemaVersion: 2,
    id: newId<'Timeline'>(),
    projectId: project.projectId,
    name: project.brief.title,
    revision: 1,
    canvas,
    template: null,
    beatMap: null,
    tracks: [
      {
        kind: 'video',
        id: 'V1',
        name: 'Design',
        enabled: true,
        items: [
          {
            type: 'program',
            id: newId<'TimelineItem'>(),
            program: { id: programId, hash },
            sourceStart: RationalTime.zero(FrameRates.fps60),
            duration: project.brief.duration,
            enabled: true,
            locked: false,
            slotId: null,
          },
        ],
      },
    ],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'none' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    authoredPrograms: [program],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return {
    timeline,
    inspection: {
      program,
      source,
      elements: [
        {
          id: '#title',
          parentId: '#stage',
          tag: 'h1',
          text: project.brief.title,
          styles: { color: '#ffffff' },
          attributes: { id: 'title' },
          start: null,
          duration: null,
          animationIds: ['reveal'],
        },
      ],
      animations: [
        {
          id: 'reveal',
          targets: ['#title'],
          at: RationalTime.zero(FrameRates.fps60),
          duration: RationalTime.fromSeconds(1, FrameRates.fps60),
          ease: 'power2.out',
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      ],
    },
  };
}
