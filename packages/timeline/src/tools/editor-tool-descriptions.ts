// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { EditorToolName } from './editor-json';

interface EditorToolText {
  readonly command: EditorToolName;
  readonly description: string;
  readonly summary: string;
  readonly tags: readonly string[];
}

export const EDITOR_TOOLS: readonly EditorToolText[] = [
  {
    command: 'timeline.splitClip',
    description:
      'Splits one clip in two at a time inside it (seconds from the video’s start). Give the clip by its number (clip 3 is 3) or "this". The first part keeps the clip’s number and id; the second part is the next number, and the answer’s itemId. Nothing moves.',
    summary: 'Splits (cuts) a clip in two, here at the playhead or at a time inside it.',
    tags: ['split', 'cut', 'halve', 'half', 'two', 'here', 'playhead'],
  },
  {
    command: 'timeline.deleteClip',
    description:
      'Deletes a clip (or gap) from the video, by its number or "this". ripple (default) closes the hole, every later cut kept on the beat, text and sound moving with the video; lift leaves a gap of the same length.',
    summary: 'Deletes (takes out) a clip or shot; what follows closes up, or a gap stays.',
    tags: ['delete', 'remove', 'take-out', 'drop', 'cut-out', 'last', 'ripple', 'gap'],
  },
  {
    command: 'timeline.insertClip',
    description:
      'Adds a library shot (video, with an in-point) or a photo at a time, before or after a clip (its number or "this"), or before a slot. Find the shot first with library.search (its assetId and shotId); a shot already in the video is not the one asked for. What follows moves later and the cuts stay on the beat. A time inside a clip splits it there. The answer’s itemId is the new clip.',
    summary:
      'Inserts (puts in) a library shot or photo at a place in the video: before, after, at the start.',
    tags: ['insert', 'add', 'put', 'shot', 'library', 'before', 'after', 'start', 'photo'],
  },
  {
    command: 'timeline.duplicateClip',
    description:
      'Puts a copy of a clip (its number or "this") right after it; what follows moves later. The answer’s itemId is the copy.',
    summary: 'Duplicates (copies) a clip right after itself.',
    tags: ['duplicate', 'copy', 'again', 'repeat'],
  },
  {
    command: 'timeline.setSpeed',
    description:
      'Changes a video clip’s speed (the clip by its number or "this"): speed 0.5 is half speed (slow motion), 2 double, 1 back to normal; or a ramp over shares of the clip. By default the clip keeps showing the same moment, so half speed makes it twice as long and what follows moves later; fit "length" keeps its length. Its own sound keeps its pitch, and is muted outside 0.5–2× unless audio says otherwise.',
    summary: 'Changes a clip’s speed: slow motion, half or quarter speed, faster, double, a ramp, or normal.',
    tags: ['speed', 'slow', 'slow-motion', 'slower', 'fast', 'faster', 'double', 'quarter', 'ramp', 'normal'],
  },
  {
    command: 'timeline.setTransition',
    description:
      'Adds (or changes) the transition at one edge of a clip (its number or "this"): edge "end" (default) into the next clip, "start" from the one before; "into the next one" is clip "this" with edge "end". Kinds: dissolve (a crossfade), fade (dip to black), flash (through white), whip, zoom (direction "down" zooms out), slide (direction: where the next clip comes from). Half a second by default.',
    summary:
      'Adds or changes a transition between clips: crossfade, dip to black, flash, whip pan, zoom, slide; its length.',
    tags: [
      'transition',
      'crossfade',
      'dissolve',
      'dip',
      'black',
      'flash',
      'whip',
      'pan',
      'zoom',
      'slide',
      'between',
      'next',
      'longer',
    ],
  },
  {
    command: 'timeline.removeTransition',
    description:
      'Removes a transition, by its id or by the clip (its number or "this") and edge it is on; the cut becomes a plain (straight) cut.',
    summary: 'Removes a transition or crossfade, leaving a straight cut.',
    tags: ['transition', 'remove', 'crossfade', 'straight', 'plain'],
  },
  {
    command: 'timeline.setGrade',
    description:
      'Changes the colour of clips (clips by their numbers, or ["this"]: a selected stretch is every clip in it) or of the whole video (no clips, wholeVideo true): exposure in stops, highlights and whites (-1 softens glaring lights without darkening shadows, +1 lifts), contrast, saturation, temperature (-1 cool to +1 warm), tint, and a look (vivid, muted, warm, cool, mono, vintage, faded, cinematic). Only the fields given change; reset starts from none. Small values (0.1–0.3) read as natural. Highlights/whites soften brightness; they cannot restore detail already clipped.',
    summary:
      'Changes the colour of clips or the video: black and white, brighter, warmer, cooler, a look, or as filmed.',
    tags: [
      'colour',
      'color',
      'grade',
      'highlights',
      'whites',
      'glare',
      'look',
      'black-and-white',
      'mono',
      'bright',
      'brighten',
      'brighter',
      'darker',
      'warm',
      'warmer',
      'cool',
      'cooler',
      'vintage',
      'saturation',
      'reset',
    ],
  },
  {
    command: 'timeline.addMarker',
    description: 'Adds a marker at a time (seconds), a note by default, with an optional label and length.',
    summary: 'Adds a marker at a time.',
    tags: ['marker', 'note'],
  },
  {
    command: 'timeline.slipClip',
    description:
      'Plays another part of a clip’s shot in the same place for the same length (the clip by its number or "this"): part {"seconds": 1.5} plays from 1.5 s later in its shot, {"seconds": -1} from a second earlier; {"avoid": ["start"]} finds a later part, past someone only getting going and the recording’s start; ["end"] an earlier one, before they slow to a stop; ["face"] one with no face. No cut moves. Longer or shorter is timeline.trimClip; another shot is timeline.swapClip.',
    summary:
      'Uses a later or earlier part of a clip’s shot, the same length: past a slow start, before a stop, or with no face.',
    tags: [
      'slip',
      'part',
      'later',
      'earlier',
      'moment',
      'starting',
      'getting-going',
      'stopping',
      'face',
      'no-face',
      'walking',
    ],
  },
  {
    command: 'audio.setVolume',
    description:
      'Changes sound levels, mute and fades: of clips (clips by their numbers or ["this"]: a video clip’s own sound; clipIds for a voice line or an effect) or a whole sound (music, voice, effects). gainDb sets the level (0 as recorded, -6 about half as loud); changeDb changes it. Fades in seconds; 0 takes one off. "Fade the music out at the end" is fadeOutSeconds (2 is gentle), never muted: muted silences it the whole way through.',
    summary:
      'Mutes, unmutes, turns up or down (dB) and fades in or out a clip’s sound, the music, the voice-over or effects.',
    tags: [
      'volume',
      'sound',
      'mute',
      'unmute',
      'louder',
      'quieter',
      'turn-up',
      'turn-down',
      'db',
      'fade',
      'fade-in',
      'fade-out',
      'music',
      'voice',
      'voice-over',
      'audio',
      'level',
    ],
  },
  {
    command: 'audio.trim',
    description:
      'Trims one edge of a voice line, an effect (clipId) or the music (sound "music"), its sound staying where it was in time: positive bySeconds lengthens at that edge, negative shortens. A video clip’s sound follows its picture (trim the clip instead).',
    summary: 'Trims (shortens or lengthens) the start or end of a voice line, an effect or the music.',
    tags: ['audio', 'trim', 'sound', 'music', 'voice', 'shorten'],
  },
  {
    command: 'audio.move',
    description:
      'Moves a voice line, an effect (clipId) or the music (sound "music") later (positive bySeconds) or earlier. Sounds on a track never overlap.',
    summary: 'Moves a voice line, an effect or the music later or earlier: where it starts.',
    tags: ['audio', 'move', 'sound', 'music', 'voice', 'later', 'earlier', 'start', 'seconds-in'],
  },
];
