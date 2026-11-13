// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The English for the keys Phase 3's export sends (render SPEC P3.10–P3.14, timeline P3-V5): the nine new QA
 * checks and their fixes, the optional stages, the landscape canvases, the bumpers fix, the per-platform AI
 * disclosure reminders (render's DISCLOSURE_V1, checked on 2026-10-14), the pro export formats and their
 * warnings, and the commands the export dialog dispatches. Explicit ids: the backend names them.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export const RENDER_MESSAGES_PHASE3: readonly MessageDescriptor[] = [
  // Errors (errors.<code>).
  msg({
    id: 'errors.render.credentials_unavailable',
    message:
      'Content Credentials couldn’t be added: their part of Taalcut isn’t ready. Try again in a moment.',
  }),
  msg({
    id: 'errors.render.credentials_invalid',
    message: 'The Content Credentials didn’t check out, so the video wasn’t saved. Export again.',
  }),
  msg({
    id: 'errors.timeline.interchange_format_unknown',
    message: 'This version of Taalcut can’t write that kind of file.',
  }),
  msg({
    id: 'errors.timeline.interchange_mismatch',
    message:
      'The file didn’t match the edit, so nothing was saved. Try again, and send feedback if it keeps happening.',
  }),

  // QA checks (qa.checks.<id>).
  msg({ id: 'qa.checks.subjectInFrame', message: 'Faces and people stay in frame' }),
  msg({ id: 'qa.checks.cropJitter', message: 'The framing moves smoothly' }),
  msg({ id: 'qa.checks.captionCoversFace', message: 'Captions clear of faces' }),
  msg({ id: 'qa.checks.graphicsSafeZone', message: 'Graphics clear of the app’s buttons' }),
  msg({ id: 'qa.checks.graphicsOverlap', message: 'Graphics don’t cover each other' }),
  msg({ id: 'qa.checks.graphicsReadability', message: 'Graphics are easy to read' }),
  msg({ id: 'qa.checks.voiceOverMusic', message: 'The voice is clear over the music' }),
  msg({ id: 'qa.checks.contentCredentials', message: 'Content Credentials are intact' }),
  msg({ id: 'qa.checks.brandAssets', message: 'Logo and watermark are in place' }),

  // QA fixes (qa.fixes.<id>) and the bumpers' error fix.
  msg({ id: 'qa.fixes.captionClearFace', message: 'Move captions off the face' }),
  msg({ id: 'qa.fixes.lengthenGraphic', message: 'Keep the graphic on longer' }),
  msg({ id: 'qa.fixes.moveGraphic', message: 'Move the graphic' }),
  msg({ id: 'qa.fixes.raiseDucking', message: 'Quieter music under the voice' }),
  msg({ id: 'qa.fixes.reframeBlurPad', message: 'Show the whole shot' }),
  msg({ id: 'qa.fixes.reframeCentre', message: 'Hold the framing still' }),
  msg({ id: 'qa.fixes.replaceBrandAsset', message: 'Move or replace the logo' }),
  msg({ id: 'fix.leaveOutBumpers', message: 'Leave out the intro and outro' }),

  // Export stages (render.stage.<stage>).
  msg({ id: 'render.stage.reframing', message: 'Framing' }),
  msg({ id: 'render.stage.grading', message: 'Matching colour' }),
  msg({ id: 'render.stage.signing', message: 'Signing' }),

  // The landscape canvases (render.presets.<id>).
  msg({ id: 'render.presets.landscape', message: 'Landscape (16:9)' }),
  msg({ id: 'render.presets.standard', message: 'Standard (4:3)' }),

  // How each app asks you to label AI content (render.disclosure.<platform>.title and .steps).
  msg({
    id: 'render.disclosure.shorts.title',
    message: 'YouTube Shorts',
    comment: 'Brand name: keep as written.',
  }),
  msg({
    id: 'render.disclosure.shorts.steps',
    message:
      'In YouTube Studio, set “Altered or synthetic content” (AI use) to Yes when the video shows a realistic person, place or event that AI made or changed, or AI music is the focus. With Content Credentials on, YouTube may label it automatically, and that label can’t be changed.',
    comment: 'Quoted words are the platform’s own labels: use the words its app shows in this language.',
  }),
  msg({
    id: 'render.disclosure.reels.title',
    message: 'Instagram and Facebook Reels',
    comment: 'Brand names: keep as written.',
  }),
  msg({
    id: 'render.disclosure.reels.steps',
    message:
      'Use “Add AI label” when realistic video or audio was made or changed with AI (an AI voiceover counts). Credentials that say “created with AI” add the label for you.',
    comment: 'Quoted words are the platform’s own labels: use the words its app shows in this language.',
  }),
  msg({ id: 'render.disclosure.tiktok.title', message: 'TikTok', comment: 'Brand name: keep as written.' }),
  msg({
    id: 'render.disclosure.tiktok.steps',
    message:
      'Turn on “AI-generated content” under More options for realistic AI images, audio or video. With Content Credentials on, TikTok adds its own label, which can’t be removed.',
    comment: 'Quoted words are the platform’s own labels: use the words its app shows in this language.',
  }),

  // Pro export (interchange.<format>.label).
  msg({ id: 'interchange.otio.label', message: 'DaVinci Resolve or Premiere Pro (.otio)' }),
  msg({ id: 'interchange.fcpxml.label', message: 'Final Cut Pro 12 (.fcpxml)' }),

  // Commands (commands.<name>).
  msg({ id: 'commands.render.setContentCredentials', message: 'Turn Content Credentials on or off' }),
  msg({ id: 'commands.music.setDucking', message: 'Lower the music under the voice' }),
  msg({ id: 'commands.sfx.setHits', message: 'Change the hits on the cuts' }),
  msg({ id: 'commands.voice.removeVoiceover', message: 'Take out the voiceover' }),
  msg({ id: 'commands.timeline.setReframe', message: 'Change a clip’s framing' }),
  msg({ id: 'commands.timeline.exportInterchange', message: 'Export for another editor' }),
];
