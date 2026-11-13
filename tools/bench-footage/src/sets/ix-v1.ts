// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `ix-v1`, the indexing-speed round's synthetic set (IX-B3, design G): ten minutes in eighteen files, shaped
 * like a creator's phone footage. 320 s is 4K (HEVC at 30 and 60 fps, one H.264), the rest 1080p H.264 and
 * HEVC, two portrait clips stored landscape with a rotation tag; speech in English, Spanish, Brazilian
 * Portuguese and Hindi from macOS `say`, under music, street noise or room tone; two music-only clips and one
 * silent one (room tone only). Every shot moves (zooming fractals, camera pans and zooms over large stills,
 * evolving patterns), shots change at hard cuts and dissolves, and some carry on-screen text. Four clips,
 * one per language and without music, are the search probes.
 */
import type { ClipSpec, FootageSet } from './types';

const EN = ['Samantha', 'Daniel'];
const ES = ['Mónica', 'Paulina'];
const PT = ['Luciana'];
const HI = ['Lekha'];

const K4 = { width: 3840, height: 2160 } as const;
const HD = { width: 1920, height: 1080 } as const;
const PORTRAIT = { width: 1080, height: 1920 } as const;

const clip = (
  spec: Omit<ClipSpec, 'onScreen' | 'bars'> & Partial<Pick<ClipSpec, 'onScreen' | 'bars'>>,
): ClipSpec => ({
  onScreen: [],
  bars: false,
  ...spec,
});

export const IX_V1: FootageSet = {
  name: 'ix-v1',
  version: 1,
  seed: 20_261_017,
  looksProbe: 'colour bars test pattern',
  clips: [
    clip({
      file: 'city-4k-hevc30-en.mov',
      ...{
        ...K4,
        fps: 30,
        codec: 'hevc',
        bitrate: '40M',
        seconds: 45,
        bed: 'room',
        createdAt: '2026-09-12T07:41:10Z',
      },
      speech: {
        language: 'en',
        voices: EN,
        probe: 'lighthouse',
        text: 'We walked past the old lighthouse at the end of the pier and watched the ferries cross the bay in the morning light.',
      },
      onScreen: ['PIER 39 FERRY'],
    }),
    clip({
      file: 'market-4k-hevc30-hi.mov',
      ...{
        ...K4,
        fps: 30,
        codec: 'hevc',
        bitrate: '40M',
        seconds: 45,
        bed: 'room',
        createdAt: '2026-09-12T10:05:44Z',
      },
      speech: {
        language: 'hi',
        voices: HI,
        probe: 'मानसून',
        text: 'आज हम पुराने बाज़ार में घूमे। मानसून की पहली बारिश हुई और सब लोग चाय की दुकान पर रुक गए।',
      },
    }),
    clip({
      file: 'beach-4k-hevc30-es.mov',
      ...{
        ...K4,
        fps: 30,
        codec: 'hevc',
        bitrate: '40M',
        seconds: 40,
        bed: 'room',
        createdAt: '2026-09-12T16:20:03Z',
      },
      speech: {
        language: 'es',
        voices: ES,
        probe: 'biblioteca',
        text: 'Por la mañana fuimos a la biblioteca del pueblo y después caminamos por la playa hasta el faro.',
      },
    }),
    clip({
      file: 'park-4k-hevc30-ptbr.mov',
      ...{
        ...K4,
        fps: 30,
        codec: 'hevc',
        bitrate: '40M',
        seconds: 40,
        bed: 'room',
        createdAt: '2026-09-13T09:12:30Z',
      },
      speech: {
        language: 'pt-BR',
        voices: PT,
        probe: 'cachoeira',
        text: 'No domingo subimos a trilha até a cachoeira e tomamos banho na água gelada antes do almoço.',
      },
    }),
    clip({
      file: 'run-4k-hevc60-en.mov',
      ...{
        ...K4,
        fps: 60,
        codec: 'hevc',
        bitrate: '60M',
        seconds: 30,
        bed: 'music',
        createdAt: '2026-09-13T06:02:18Z',
      },
      speech: {
        language: 'en',
        voices: EN,
        probe: null,
        text: 'Mile seven felt easy today. The river path was quiet, and the sun came up behind the bridge as I picked up the pace.',
      },
    }),
    clip({
      file: 'bike-4k-hevc60-music.mov',
      ...{
        ...K4,
        fps: 60,
        codec: 'hevc',
        bitrate: '60M',
        seconds: 30,
        bed: 'music',
        createdAt: '2026-09-13T07:30:00Z',
      },
      speech: null,
      bars: true,
    }),
    clip({
      file: 'skate-4k-hevc60-es.mov',
      ...{
        ...K4,
        fps: 60,
        codec: 'hevc',
        bitrate: '60M',
        seconds: 30,
        bed: 'noise',
        createdAt: '2026-09-13T17:45:51Z',
      },
      speech: {
        language: 'es',
        voices: ES,
        probe: null,
        text: 'El parque de patinaje está lleno los sábados. Hoy aprendí a girar en la rampa grande sin caerme.',
      },
      onScreen: ['SKATE PARK OPEN'],
    }),
    clip({
      file: 'kitchen-1080-h264-en.mp4',
      ...{
        ...HD,
        fps: 30,
        codec: 'h264',
        bitrate: '16M',
        seconds: 40,
        bed: 'none',
        createdAt: '2026-09-13T19:10:27Z',
      },
      speech: {
        language: 'en',
        voices: EN,
        probe: null,
        text: 'First the garlic goes into the pan, then the mushrooms and a splash of cream. Stir it slowly until the sauce turns golden.',
      },
      onScreen: ['GARLIC CREAM PASTA'],
    }),
    clip({
      file: 'studio-1080-h264-hi.mp4',
      ...{
        ...HD,
        fps: 30,
        codec: 'h264',
        bitrate: '16M',
        seconds: 35,
        bed: 'music',
        createdAt: '2026-09-13T21:33:09Z',
      },
      speech: {
        language: 'hi',
        voices: HI,
        probe: null,
        text: 'आज स्टूडियो में हमने नया गाना रिकॉर्ड किया। ढोलक और बांसुरी की आवाज़ बहुत सुंदर लगी।',
      },
      onScreen: ['TAKE 4'],
    }),
    clip({
      file: 'garden-1080-h264-ptbr.mp4',
      ...{
        ...HD,
        fps: 30,
        codec: 'h264',
        bitrate: '16M',
        seconds: 35,
        bed: 'noise',
        createdAt: '2026-09-14T08:48:55Z',
      },
      speech: {
        language: 'pt-BR',
        voices: PT,
        probe: null,
        text: 'O jardim está florido nesta época do ano. As abelhas visitam as flores e os pássaros cantam o dia todo.',
      },
      onScreen: ['JARDIM BOTANICO'],
    }),
    clip({
      file: 'desk-1080-h264-en.mp4',
      ...{
        ...HD,
        fps: 30,
        codec: 'h264',
        bitrate: '16M',
        seconds: 25,
        bed: 'none',
        createdAt: '2026-09-14T11:02:40Z',
      },
      speech: {
        language: 'en',
        voices: EN,
        probe: null,
        text: 'This is my desk setup: a mechanical keyboard, two monitors and a lamp that I built from an old camera tripod.',
      },
      onScreen: ['KEYBOARD SALE 50 OFF', 'NEW SETUP 2026'],
    }),
    clip({
      file: 'rooftop-portrait-hevc30-hi.mov',
      ...{
        ...PORTRAIT,
        fps: 30,
        codec: 'hevc',
        bitrate: '10M',
        seconds: 35,
        bed: 'none',
        createdAt: '2026-09-14T18:15:12Z',
      },
      speech: {
        language: 'hi',
        voices: HI,
        probe: null,
        text: 'छत से पूरा शहर दिखता है। शाम को आसमान नारंगी हो जाता है और पतंगें उड़ती हैं।',
      },
    }),
    clip({
      file: 'street-portrait-h264-en.mp4',
      ...{
        ...PORTRAIT,
        fps: 30,
        codec: 'h264',
        bitrate: '16M',
        seconds: 30,
        bed: 'noise',
        createdAt: '2026-09-14T20:40:33Z',
      },
      speech: {
        language: 'en',
        voices: EN,
        probe: null,
        text: 'The night market opens at eight. Grab some dumplings, find a table by the fountain and listen to the street band.',
      },
      onScreen: ['NIGHT MARKET'],
    }),
    clip({
      file: 'lake-1080-h264-silent.mp4',
      ...{
        ...HD,
        fps: 30,
        codec: 'h264',
        bitrate: '16M',
        seconds: 30,
        bed: 'room',
        createdAt: '2026-09-15T06:30:00Z',
      },
      speech: null,
      bars: true,
    }),
    clip({
      file: 'concert-4k-hevc30-music.mov',
      ...{
        ...K4,
        fps: 30,
        codec: 'hevc',
        bitrate: '40M',
        seconds: 35,
        bed: 'music',
        createdAt: '2026-09-15T22:04:19Z',
      },
      speech: null,
      onScreen: ['LIVE TONIGHT'],
    }),
    clip({
      file: 'garden-1080-hevc30-es.mov',
      ...{
        ...HD,
        fps: 30,
        codec: 'hevc',
        bitrate: '10M',
        seconds: 25,
        bed: 'none',
        createdAt: '2026-09-16T09:27:46Z',
      },
      speech: {
        language: 'es',
        voices: ES,
        probe: null,
        text: 'Les presento mi huerto: tomates, albahaca y pimientos que plantamos en primavera con mi abuela.',
      },
      bars: true,
    }),
    clip({
      file: 'studio-1080-hevc60-en.mov',
      ...{
        ...HD,
        fps: 60,
        codec: 'hevc',
        bitrate: '16M',
        seconds: 25,
        bed: 'music',
        createdAt: '2026-09-16T14:51:08Z',
      },
      speech: {
        language: 'en',
        voices: EN,
        probe: null,
        text: 'Quick update from the studio. The new song is almost finished and we are recording the drums tomorrow.',
      },
    }),
    clip({
      file: 'coffee-4k-h264-30-ptbr.mp4',
      ...{
        ...K4,
        fps: 30,
        codec: 'h264',
        bitrate: '50M',
        seconds: 25,
        bed: 'music',
        createdAt: '2026-09-16T16:09:59Z',
      },
      speech: {
        language: 'pt-BR',
        voices: PT,
        probe: null,
        text: 'Hoje vou mostrar como preparar um café coado perfeito, com água quente e grãos moídos na hora.',
      },
    }),
  ],
};
