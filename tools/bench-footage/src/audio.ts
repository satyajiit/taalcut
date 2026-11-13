// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's sound: speech from macOS `say` (the text again and again with pauses until the clip is full), over
 * its bed: a seeded music loop (a four-chord pad, bass, kick and an off-beat tick at the plan's tempo), pink
 * street noise, or brown room tone, all as FFmpeg sources. Phones record 48 kHz stereo AAC; so does this.
 */
import type { ClipPlan } from './plan';

export interface SayRun {
  readonly voice: string;
  readonly text: string;
  readonly path: string;
}

/** About 2.6 spoken words a second, and a 1.2 s pause between repeats. */
export function sayRun(text: string, voice: string, seconds: number, path: string): SayRun {
  const words = text.split(/\s+/).filter(Boolean).length;
  const once = words / 2.6 + 1.2;
  const repeats = Math.ceil(seconds / once) + 1;
  return { voice, path, text: Array.from({ length: repeats }, () => text).join(' [[slnc 1200]] ') };
}

function musicExpression(bpm: number, rootHz: number): string {
  const beat = 60 / bpm;
  const chord = `mod(floor(t/${2 * beat}),4)`;
  const root = `${rootHz}*if(eq(${chord},0),1,if(eq(${chord},1),1.3348,if(eq(${chord},2),1.4983,1.1225)))`;
  return [
    `0.09*(sin(2*PI*${root}*t)+0.7*sin(2*PI*${root}*1.2599*t)+0.6*sin(2*PI*${root}*1.4983*t))`,
    `0.18*sin(PI*${root}*t)*(0.5+0.5*exp(-6*mod(t,${beat})))`,
    `0.4*sin(2*PI*52*t)*exp(-22*mod(t,${beat}))`,
    `0.04*sin(2*PI*5300*t)*exp(-80*mod(t+${beat / 2},${beat}))`,
  ].join('+');
}

/**
 * The audio part of the clip's graph, reading speech (if any) from input `speechInput`; ends in `[a]`, or is
 * null for a clip with neither speech nor bed (none in ix-v1).
 */
export function audioGraph(plan: ClipPlan, speechInput: number | null): string | null {
  const seconds = plan.clip.seconds;
  const chains: string[] = [];
  if (speechInput !== null)
    chains.push(
      `[${speechInput}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad=whole_dur=${seconds},atrim=0:${seconds}[speech]`,
    );
  const underSpeech = speechInput !== null;
  switch (plan.clip.bed) {
    case 'music': {
      const music = plan.music ?? { bpm: 112, rootHz: 220 };
      const expression = musicExpression(music.bpm, music.rootHz);
      chains.push(
        `aevalsrc=exprs='${expression}|${expression}':s=48000:d=${seconds},volume=${underSpeech ? 0.35 : 1}[bed]`,
      );
      break;
    }
    case 'noise':
      chains.push(
        `anoisesrc=d=${seconds}:c=pink:r=48000:a=0.06:seed=${plan.noiseSeed},aformat=channel_layouts=stereo[bed]`,
      );
      break;
    case 'room':
      chains.push(
        `anoisesrc=d=${seconds}:c=brown:r=48000:a=0.01:seed=${plan.noiseSeed},aformat=channel_layouts=stereo[bed]`,
      );
      break;
    case 'none':
      break;
  }
  const bed = plan.clip.bed !== 'none';
  if (underSpeech && bed) chains.push('[speech][bed]amix=inputs=2:duration=first:normalize=0[a]');
  else if (underSpeech) chains.push('[speech]anull[a]');
  else if (bed) chains.push('[bed]anull[a]');
  else return null;
  return chains.join(';');
}
