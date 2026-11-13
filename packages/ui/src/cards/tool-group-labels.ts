// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import { toolLabel } from './labels';

/**
 * A run of calls to one tool, named as one row (FIX-TOOLGROUPS): TOOL_LABELS' words with the count, "Inspect 11
 * clips" for eleven "Inspect a clip". The name stays the same while the calls run and once they are done, as a
 * single call's does; the chip and the line beside it say how it went. Tools the agent calls many times in a row
 * have their own words here; any other says its usual name and how many times ("Search your clips, 3 times").
 */
export const TOOL_GROUP_LABELS: Readonly<Record<string, (count: number) => MessageDescriptor>> = {
  // Library & clips
  'library.addSource': (count) => msg`${plural(count, { one: 'Add # folder', other: 'Add # folders' })}`,
  'library.recheckSource': (count) =>
    msg`${plural(count, { one: 'Check # folder', other: 'Check # folders' })}`,
  'library.getAsset': (count) => msg`${plural(count, { one: 'Inspect # clip', other: 'Inspect # clips' })}`,
  'library.getShotCard': (count) =>
    msg`${plural(count, { one: 'Read the details of # shot', other: 'Read the details of # shots' })}`,
  'library.importStock': (count) =>
    msg`${plural(count, { one: 'Download # stock video', other: 'Download # stock videos' })}`,
  // Media & vision
  'media.probe': (count) => msg`${plural(count, { one: 'Check # video', other: 'Check # videos' })}`,
  'vision.describeFrame': (count) =>
    msg`${plural(count, { one: 'Look at # frame', other: 'Look at # frames' })}`,
  'vision.detectShots': (count) =>
    msg`${plural(count, { one: 'Find the shots in # clip', other: 'Find the shots in # clips' })}`,
  'vision.indexAsset': (count) => msg`${plural(count, { one: 'Index # clip', other: 'Index # clips' })}`,
  'audio.transcribe': (count) =>
    msg`${plural(count, { one: 'Transcribe speech in # clip', other: 'Transcribe speech in # clips' })}`,
  // Captions & reels
  'captions.editSegment': (count) =>
    msg`${plural(count, { one: 'Edit # caption', other: 'Edit # captions' })}`,
  'templates.judgeCut': (count) => msg`${plural(count, { one: 'Check # cut', other: 'Check # cuts' })}`,
  'templates.fetchReference': (count) => msg`${plural(count, { one: 'Get # reel', other: 'Get # reels' })}`,
  'templates.importSavedReel': (count) =>
    msg`${plural(count, { one: 'Import # Saved reel', other: 'Import # Saved reels' })}`,
  // Timeline
  'timeline.captureFrame': (count) =>
    msg`${plural(count, { one: 'Capture # frame', other: 'Capture # frames' })}`,
  'timeline.fillGap': (count) =>
    msg`${plural(count, { one: 'Fill # missing shot', other: 'Fill # missing shots' })}`,
  'timeline.swapClip': (count) => msg`${plural(count, { one: 'Swap # clip', other: 'Swap # clips' })}`,
  'timeline.trimClip': (count) => msg`${plural(count, { one: 'Trim # clip', other: 'Trim # clips' })}`,
  'timeline.splitClip': (count) => msg`${plural(count, { one: 'Split # clip', other: 'Split # clips' })}`,
  'timeline.moveClip': (count) => msg`${plural(count, { one: 'Move # clip', other: 'Move # clips' })}`,
  'timeline.deleteClip': (count) => msg`${plural(count, { one: 'Remove # clip', other: 'Remove # clips' })}`,
  'timeline.setTransition': (count) =>
    msg`${plural(count, { one: 'Set # transition', other: 'Set # transitions' })}`,
  // Images & memory
  'images.generateForSlot': (count) =>
    msg`${plural(count, { one: 'Generate images for # slot', other: 'Generate images for # slots' })}`,
  'memory.remember': (count) =>
    msg`${plural(count, { one: 'Remember # thing for later', other: 'Remember # things for later' })}`,
  // Workspace, motion graphics, vision, voice & templates
  'workspace.read': (count) =>
    msg`${plural(count, { one: 'Read # workspace file', other: 'Read # workspace files' })}`,
  'workspace.write': (count) =>
    msg`${plural(count, { one: 'Write # workspace file', other: 'Write # workspace files' })}`,
  'workspace.patch': (count) =>
    msg`${plural(count, { one: 'Edit # workspace file', other: 'Edit # workspace files' })}`,
  'workspace.delete': (count) =>
    msg`${plural(count, { one: 'Delete # workspace file', other: 'Delete # workspace files' })}`,
  'workspace.render': (count) =>
    msg`${plural(count, { one: 'Render # motion graphic', other: 'Render # motion graphics' })}`,
  'workspace.place': (count) =>
    msg`${plural(count, { one: 'Place # motion graphic on the video', other: 'Place # motion graphics on the video' })}`,
  'vision.detectCuts': (count) =>
    msg`${plural(count, { one: 'Detect scene cuts in # clip', other: 'Detect scene cuts in # clips' })}`,
  'vision.readText': (count) =>
    msg`${plural(count, { one: 'Read on-screen text in # frame', other: 'Read on-screen text in # frames' })}`,
  'stock.import': (count) =>
    msg`${plural(count, { one: 'Download # stock clip', other: 'Download # stock clips' })}`,
  'library.findSimilar': (count) =>
    msg`${plural(count, { one: 'Find similar clips for # shot', other: 'Find similar clips for # shots' })}`,
  'voice.editLine': (count) =>
    msg`${plural(count, { one: 'Edit # voice-over line', other: 'Edit # voice-over lines' })}`,
  'voice.generate': (count) =>
    msg`${plural(count, { one: 'Generate # voice-over line', other: 'Generate # voice-over lines' })}`,
  'templates.dropSlot': (count) =>
    msg`${plural(count, { one: 'Remove # template slot', other: 'Remove # template slots' })}`,
  'templates.editIntent': (count) =>
    msg`${plural(count, { one: 'Edit # slot description', other: 'Edit # slot descriptions' })}`,
  'templates.renameSlot': (count) =>
    msg`${plural(count, { one: 'Rename # template slot', other: 'Rename # template slots' })}`,
};

/** "Inspect 11 clips": a run of `count` calls to `tool`, named as one row. */
export function toolGroupLabel(i18n: I18n, tool: string, count: number): string {
  const words = TOOL_GROUP_LABELS[tool];
  if (words) return i18n._(words(count));
  const label = toolLabel(i18n, tool);
  if (count === 1) return label;
  return i18n._(msg`${label}, ${plural(count, { one: '# time', other: '# times' })}`);
}
