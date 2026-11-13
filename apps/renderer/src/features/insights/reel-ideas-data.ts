// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { buildAgentPromptFromTrack, type EditsAudioTrack } from '../make/edits-pulse-model';

export interface ReelIdeaScene {
  readonly label: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly role: 'hook' | 'build' | 'payoff' | 'cta';
}

export interface ReelIdea {
  readonly id: string;
  readonly title: string;
  readonly formatBadge: string;
  readonly hookFormula: string;
  readonly description: string;
  readonly durationSeconds: number;
  /** Only a supplied feed identifier can pair an idea with audio. Generic presets omit this. */
  readonly pairedTrackId?: string;
  readonly category: 'product-launch' | 'custom';
  readonly scenes: readonly ReelIdeaScene[];
  readonly prompt: string;
}

/** Creative suggestions, not measured trends or claims about music rights and performance. */
export function getReelIdeas(i18n: I18n): readonly ReelIdea[] {
  const scene = (
    label: string,
    startSeconds: number,
    endSeconds: number,
    role: ReelIdeaScene['role'],
  ): ReelIdeaScene => ({ label, startSeconds, endSeconds, role });
  return [
    {
      id: 'idea-reveal-drop',
      title: t(i18n)`A glimpse, a process, a reveal`,
      formatBadge: t(i18n)`Reveal`,
      hookFormula: t(i18n)`Show a glimpse of the result, then return to how it was made.`,
      description: t(i18n)`A starting point for product launches, crafts, and visual transformations.`,
      durationSeconds: 26,
      category: 'product-launch',
      scenes: [
        scene(t(i18n)`Glimpse`, 0, 3, 'hook'),
        scene(t(i18n)`Process`, 3, 14, 'build'),
        scene(t(i18n)`Reveal`, 14, 22, 'payoff'),
        scene(t(i18n)`Closing detail`, 22, 26, 'cta'),
      ],
      prompt: t(
        i18n,
      )`Create a 26-second before-and-after reel from my footage. Open with a brief glimpse of the result, show the process, reveal the transformation, and close on a useful detail. Treat the scene timings as suggestions and adapt them to the available footage.`,
    },
    {
      id: 'idea-photo-dump-foley',
      title: t(i18n)`Six shots from one day`,
      formatBadge: t(i18n)`Quick montage`,
      hookFormula: t(i18n)`Connect six short clips through a recurring movement or visual detail.`,
      description: t(i18n)`Collect moments from a shoot, a studio day, or a trip into a short sequence.`,
      durationSeconds: 12,
      category: 'custom',
      scenes: [
        scene(t(i18n)`Opening detail`, 0, 2, 'hook'),
        scene(t(i18n)`Sequence`, 2, 6, 'build'),
        scene(t(i18n)`Standout moment`, 6, 10, 'payoff'),
        scene(t(i18n)`Return`, 10, 12, 'cta'),
      ],
      prompt: t(
        i18n,
      )`Create a 12-second montage using six short shots from my footage. Find a recurring movement or visual detail to connect the cuts. Keep any text brief and finish with a shot that relates to the opening. Adapt the timing to the clips.`,
    },
    {
      id: 'idea-golden-hour-pov',
      title: t(i18n)`A place through your eyes`,
      formatBadge: t(i18n)`Atmosphere`,
      hookFormula: t(i18n)`Start in motion, then alternate wider views with close details.`,
      description: t(i18n)`Use travel, food, or everyday footage to give a sense of being there.`,
      durationSeconds: 20,
      category: 'custom',
      scenes: [
        scene(t(i18n)`Arrival`, 0, 3, 'hook'),
        scene(t(i18n)`Details`, 3, 9, 'build'),
        scene(t(i18n)`Wider view`, 9, 16, 'payoff'),
        scene(t(i18n)`Departure`, 16, 20, 'cta'),
      ],
      prompt: t(
        i18n,
      )`Create a 20-second point-of-view reel from my footage. Open with movement, show a few close details, reveal the wider setting, and end with a departure shot. Keep useful natural sound and adapt the pacing to the footage.`,
    },
    {
      id: 'idea-before-after-makeover',
      title: t(i18n)`One problem, one change`,
      formatBadge: t(i18n)`Before and after`,
      hookFormula: t(i18n)`Make the starting state clear before showing what changed.`,
      description: t(i18n)`A simple comparison for workspace setups, design changes, and makeovers.`,
      durationSeconds: 14,
      category: 'product-launch',
      scenes: [
        scene(t(i18n)`Before`, 0, 3, 'hook'),
        scene(t(i18n)`The change`, 3, 6, 'build'),
        scene(t(i18n)`After`, 6, 11, 'payoff'),
        scene(t(i18n)`Takeaway`, 11, 14, 'cta'),
      ],
      prompt: t(
        i18n,
      )`Create a 14-second before-and-after reel from my footage. Establish the starting problem, show the change, compare the result, and close with one takeaway. Match framing where possible and adjust timing to the footage.`,
    },
    {
      id: 'idea-creator-original-vox',
      title: t(i18n)`A short story with supporting shots`,
      formatBadge: t(i18n)`Story and footage`,
      hookFormula: t(i18n)`Introduce one idea, then use footage that makes it concrete.`,
      description: t(i18n)`Combine a spoken thought or short captions with relevant shots from your library.`,
      durationSeconds: 18,
      category: 'custom',
      scenes: [
        scene(t(i18n)`Introduction`, 0, 3, 'hook'),
        scene(t(i18n)`Context`, 3, 8, 'build'),
        scene(t(i18n)`Example`, 8, 14, 'payoff'),
        scene(t(i18n)`Closing thought`, 14, 18, 'cta'),
      ],
      prompt: t(
        i18n,
      )`Create an 18-second story reel using my footage and any relevant recorded speech. Introduce one idea, give context, illustrate it with supporting shots, and close with a short thought. Use concise captions where helpful; do not invent quotes.`,
    },
    {
      id: 'idea-night-drive-cinematic',
      title: t(i18n)`A story in four chapters`,
      formatBadge: t(i18n)`Walkthrough`,
      hookFormula: t(i18n)`Give each chapter a distinct subject and enough time to understand it.`,
      description: t(i18n)`Organize a travel recap, product tour, or project story into four parts.`,
      durationSeconds: 30,
      category: 'custom',
      scenes: [
        scene(t(i18n)`Setting`, 0, 5, 'hook'),
        scene(t(i18n)`Development`, 5, 13, 'build'),
        scene(t(i18n)`Main moment`, 13, 23, 'payoff'),
        scene(t(i18n)`Conclusion`, 23, 30, 'cta'),
      ],
      prompt: t(
        i18n,
      )`Create a 30-second reel in four chapters from my footage: setting, development, main moment, and conclusion. Choose a clear visual subject for each chapter and adapt the suggested pacing to what is available.`,
    },
  ];
}

export function pairedTrackForIdea(
  idea: ReelIdea,
  tracks: readonly EditsAudioTrack[],
): EditsAudioTrack | undefined {
  return idea.pairedTrackId
    ? tracks.find((track) => track.id === idea.pairedTrackId || track.audioAssetId === idea.pairedTrackId)
    : undefined;
}

export function buildReelIdeaPrompt(idea: ReelIdea, pairedTrack?: EditsAudioTrack): string {
  return pairedTrack ? `${idea.prompt} ${buildAgentPromptFromTrack(pairedTrack)}` : idea.prompt;
}

export function buildReelIdeaSearch(idea: ReelIdea, pairedTrack?: EditsAudioTrack) {
  return {
    category: idea.category,
    title: idea.title,
    prompt: buildReelIdeaPrompt(idea, pairedTrack),
    duration: idea.durationSeconds,
    ...(pairedTrack ? { audioAssetId: pairedTrack.audioAssetId } : {}),
  };
}
