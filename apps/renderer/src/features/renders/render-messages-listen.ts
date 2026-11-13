// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The English for the keys render's sound checks send (EAR1-A2): the critique's fixes and tips (`audio.critique.*`,
 * with their values: dB, LU, LUFS and seconds) and the two new QA fix buttons. Explicit ids: audio's critique names
 * them (CRITIQUE_MESSAGE_KEYS); packages/ui's render words look them up with their values.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export const RENDER_MESSAGES_LISTEN: readonly MessageDescriptor[] = [
  msg({
    id: 'audio.critique.fix.lufsLow',
    message: 'Raise the loudness by {gainDb} dB, to about {targetLufs} LUFS',
  }),
  msg({
    id: 'audio.critique.fix.lufsHigh',
    message: 'Turn the loudness down by {cutDb} dB, to about {targetLufs} LUFS',
  }),
  msg({
    id: 'audio.critique.fix.truePeakHigh',
    message: 'The peaks reach {truePeakDbtp} dBTP: limit them to {ceilingDbtp} dBTP',
  }),
  msg({
    id: 'audio.critique.fix.realnessSynthetic',
    message: 'The sound reads as made by code: use recordings for the synthetic layers',
  }),
  msg({
    id: 'audio.critique.fix.realnessLeaning',
    message: 'The sound leans synthetic: replace the most synthetic layers with recordings',
  }),
  msg({
    id: 'audio.critique.fix.realnessUncertain',
    message: 'The sound may read as synthetic: find the layer that sounds made by code',
  }),
  msg({ id: 'audio.critique.fix.realnessWindow', message: 'Sounds synthetic from {start} s to {end} s' }),
  msg({
    id: 'audio.critique.fix.musicLow',
    message: 'Music plays in only part of the video: run one track under all of it',
  }),
  msg({ id: 'audio.critique.fix.musicGap', message: 'No music from {start} s to {end} s' }),
  msg({
    id: 'audio.critique.fix.cutsWithoutOnset',
    message: 'Cuts without a new sound: {missing} of {total}',
  }),
  msg({
    id: 'audio.critique.fix.cutNoSound',
    message: 'No sound on the cut at {t} s: add a whoosh, a hit or a click',
  }),
  msg({ id: 'audio.critique.fix.cutNoOnset', message: 'No new sound on the cut at {t} s' }),
  msg({
    id: 'audio.critique.fix.lraHigh',
    message: 'The loudness swings {value} LU: lift the quiet part from {quietStart} s',
  }),
  msg({
    id: 'audio.critique.fix.lraLow',
    message: 'The loudness never moves ({value} LU): give the video calmer and louder parts',
  }),
  msg({
    id: 'audio.critique.fix.crestHigh',
    message: 'The loudest moment, at {loudAt} s, stands {value} LU above the rest: tame it or lift the rest',
  }),
  msg({
    id: 'audio.critique.fix.crestLow',
    message: 'No moment stands out ({value} LU): let the main hit rise above the rest',
  }),
  msg({
    id: 'audio.critique.fix.firstSoundQuiet',
    message: 'The opening is quiet until {at} s: raise it or start the music at once',
  }),
  msg({
    id: 'audio.critique.fix.firstSoundSilent',
    message: 'Silence until {at} s: start the sound at once',
  }),
  msg({
    id: 'audio.critique.fix.endSilence',
    message: '{seconds} s of silence at the end: trim it or let the last sound ring out',
  }),
  msg({
    id: 'audio.critique.fix.silentGaps',
    message: 'Silent holes inside the video (the longest {longest} s): keep a bed under them',
  }),
  msg({ id: 'audio.critique.fix.silentGap', message: 'Silent from {start} s to {end} s' }),
  msg({
    id: 'audio.critique.fix.finalLow',
    message: 'The ending sits {below} LU under the rest: end on a sting or a hit',
  }),
  msg({
    id: 'audio.critique.fix.finalHigh',
    message: 'The final hit is {above} LU above the rest: lower it 2–3 dB',
  }),
  msg({
    id: 'audio.critique.fix.onsetsSparse',
    message: 'Sparse sound ({rate} onsets a second): add rhythm or sounds on the actions',
  }),
  msg({
    id: 'audio.critique.fix.onsetsBusy',
    message: 'Busy sound ({rate} onsets a second): thin out the effects',
  }),
  msg({
    id: 'audio.critique.fix.hitsFew',
    message: 'Few hits mark the key moments: add impacts on the biggest cuts',
  }),
  msg({ id: 'audio.critique.fix.hitMissing', message: 'Add a hit on the cut at {t} s' }),
  msg({ id: 'audio.critique.fix.hitsMany', message: 'Too many hits: keep the biggest and soften the rest' }),
  msg({
    id: 'audio.critique.fix.introLow',
    message: 'The opening sits {below} LU under the rest: start closer to full level',
  }),
  msg({ id: 'audio.critique.fix.introHigh', message: 'The opening is {above} LU louder than the rest' }),
  msg({
    id: 'audio.critique.fix.endLow',
    message: 'The last part sits {below} LU under the rest: keep the energy to the end',
  }),
  msg({ id: 'audio.critique.fix.endHigh', message: 'The last part is {above} LU louder than the rest' }),
  msg({ id: 'audio.critique.fix.fadeLong', message: 'A {seconds} s fade-out: end on a sting or a hard cut' }),
  msg({ id: 'audio.critique.fix.fadeHard', message: 'The end is cut hard: let the last hit ring out' }),
  msg({ id: 'audio.critique.fix.stereoMono', message: 'The mix is mono: use stereo music and ambience' }),
  msg({
    id: 'audio.critique.fix.stereoNarrow',
    message: 'The mix is nearly mono: widen the music and ambience',
  }),
  msg({
    id: 'audio.critique.fix.stereoWide',
    message: 'The mix is very wide: check it in mono and narrow the ambience',
  }),
  msg({ id: 'audio.critique.fix.bandSubLow', message: 'Thin bottom: add a sub layer under the reveals' }),
  msg({
    id: 'audio.critique.fix.bandSubHigh',
    message: 'Too much rumble: high-pass the effects at 30–40 Hz',
  }),
  msg({ id: 'audio.critique.fix.bandLowLow', message: 'Weak low end: choose a fuller track or add bass' }),
  msg({ id: 'audio.critique.fix.bandLowHigh', message: 'Boomy: cut 100–200 Hz on the music' }),
  msg({ id: 'audio.critique.fix.bandLowmidLow', message: 'Hollow: lift 250 Hz–1 kHz on the music' }),
  msg({ id: 'audio.critique.fix.bandLowmidHigh', message: 'Muddy: cut 300–500 Hz on the music bed' }),
  msg({
    id: 'audio.critique.fix.bandMidLow',
    message: 'Recessed mids: lift 1–3 kHz on the effects and voice',
  }),
  msg({ id: 'audio.critique.fix.bandMidHigh', message: 'Harsh mids: cut 1–3 kHz on the loudest layer' }),
  msg({ id: 'audio.critique.fix.bandPresenceLow', message: 'Dull: brighten the effects' }),
  msg({ id: 'audio.critique.fix.bandPresenceHigh', message: 'Harsh highs: cut 5–7 kHz or de-ess' }),
  msg({ id: 'audio.critique.fix.bandAirLow', message: 'Muffled: use full-band recordings' }),
  msg({ id: 'audio.critique.fix.bandAirHigh', message: 'Hissy: low-pass or de-noise the noisiest layer' }),
  msg({ id: 'audio.critique.tip.cutsNoSound', message: 'Cuts with no sound at all: {count} of {total}' }),
  msg({
    id: 'audio.critique.tip.realnessUnconfirmed',
    message: 'Not confirmed as recorded sound, but nothing synthetic was found',
  }),
  msg({
    id: 'audio.critique.tip.noStopdowns',
    message: 'Try a short drop-out before the biggest cut, at {at} s',
  }),
  msg({
    id: 'audio.critique.tip.voiceDuck',
    message: 'There is a voice in most of the video: duck the music under it',
  }),
  msg({ id: 'qa.fixes.resyncHits', message: 'Put the effects back on their cuts' }),
  msg({ id: 'qa.fixes.findClick', message: 'Find the click' }),
];
