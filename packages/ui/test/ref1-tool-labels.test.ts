// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// REF1 gate finding 1: the plan card named the reel's tools "A step". Each tool the agent uses to read a reel, and to
// get an older template's reel again, has a plain name.
import { i18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import { flowStepLabel, toolLabel } from '../src/index';

describe('the reel tools’ names in a plan (REF1)', () => {
  it('names each step of reading a reel, and getting it again', () => {
    expect(
      [
        'templates.fetchReference',
        'templates.referenceStatus',
        'templates.judgeCut',
        'templates.resolveCuts',
        'templates.setIntents',
        'templates.finalise',
        'templates.fetchMedia',
      ].map((tool) => toolLabel(i18n, tool)),
    ).toEqual([
      'Get the reel',
      'Check where the reel is',
      'Check a cut',
      'Settle the cuts',
      'Describe the slots',
      'Save the template',
      'Get the reel’s video and music',
    ]);
  });

  it('names workspace, design, timeline, vision, audio, stock, template, hub and plugin tools without falling back to "A step"', () => {
    const tools = [
      'workspace.list',
      'workspace.read',
      'workspace.new',
      'workspace.write',
      'workspace.patch',
      'workspace.delete',
      'workspace.move',
      'workspace.search',
      'workspace.lint',
      'workspace.render',
      'workspace.renderOver',
      'workspace.place',
      'workspace.replace',
      'workspace.files',
      'workspace.open',
      'workspace.exec',
      'workspace.importMedia',
      'design.done',
      'design.none',
      'graphics.list',
      'sandbox.files',
      'sandbox.run',
      'timeline.get',
      'timeline.findAlternates',
      'timeline.assemble',
      'timeline.gaps',
      'timeline.makeVariants',
      'timeline.fitTemplates',
      'timeline.applyStyleToMany',
      'timeline.captureFrame',
      'render.draft',
      'render.export',
      'render.exportBatch',
      'render.getQaReport',
      'render.list',
      'render.listPresets',
      'render.setExportPreset',
      'render.status',
      'video.done',
      'vision.contactSheet',
      'vision.detectCuts',
      'vision.confirmCuts',
      'vision.readText',
      'vision.matchLook',
      'audio.analyzeCleanup',
      'audio.classifyAudio',
      'audio.measureLoudness',
      'audio.trackBeats',
      'captions.translate',
      'music.findLibraryTrack',
      'music.useLibraryTrack',
      'music.setDucking',
      'sfx.addHits',
      'sfx.generateHit',
      'voice.editLine',
      'voice.finalize',
      'voice.generate',
      'voice.place',
      'voice.fitScript',
      'stock.import',
      'stock.search',
      'library.findSimilar',
      'library.importStatus',
      'library.listFiles',
      'templates.abandonBreakdown',
      'templates.approveSlots',
      'templates.dropSlot',
      'templates.editIntent',
      'templates.mergeSlots',
      'templates.renameSlot',
      'templates.listInstagramCollections',
      'templates.listInstagramSavedReels',
      'templates.planFromFormat',
      'templates.search',
      'hub.fork',
      'hub.openShare',
      'plugins.callExternal',
      'plugins.callRead',
      'plugins.describe',
      'plugins.list',
      'plugins.listTools',
      'plugins.readSkill',
      'plugins.requestSetup',
    ];
    for (const tool of tools) {
      expect(toolLabel(i18n, tool), tool).not.toBe('A step');
    }
  });

  it('names every flow and skill step key without falling back to "A step"', () => {
    const stepKeys = [
      'flows.step.voiceFinalize',
      'skills.agent.gaps',
      'skills.voice.director',
      'skills.render.designer',
      'skills.render.reviewer',
    ];
    for (const key of stepKeys) {
      expect(flowStepLabel(i18n, key), key).not.toBe('A step');
    }
  });

  it('still says "A step" for a tool it doesn’t know', () => {
    expect(toolLabel(i18n, 'templates.notATool')).toBe('A step');
  });
});
