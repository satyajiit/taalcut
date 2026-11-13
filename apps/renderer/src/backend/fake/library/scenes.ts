// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output and footage colours: data, never translated */

/**
 * What the fake library's footage shows: a creator's trip, a city, food and
 * home. Each scene is the description a vision model would write and the
 * colours the fake thumbnails are painted in (fake-media.ts), so a clip's
 * picture and its words agree. Colours here are pixels of made-up footage,
 * not UI: the UI's colours are tokens.
 */
export type SceneLayout = 'horizon' | 'city' | 'closeup' | 'room' | 'water';

export interface Scene {
  readonly description: string;
  readonly objects: readonly string[];
  /** What people (or animals) in it are doing, as the describer stores them (LIB1-FIND): fixed words, then free. */
  readonly actions?: readonly string[];
  readonly place: string | null;
  readonly onScreenText?: string;
  readonly layout: SceneLayout;
  /** Sky (top, bottom), ground, and one bright detail. */
  readonly colours: readonly [string, string, string, string];
}

export const SCENES: readonly Scene[] = [
  {
    description: 'Waves rolling onto a wide beach at sunset, a few people walking along the water',
    objects: ['beach', 'sea', 'sunset', 'people'],
    actions: ['walking'],
    place: 'Palolem beach',
    layout: 'water',
    colours: ['#f2a65a', '#f7d9a0', '#3d5a73', '#fff1c7'],
  },
  {
    description: 'Close-up of chai being poured into small glasses at a roadside stall',
    objects: ['chai', 'glass', 'kettle', 'hands'],
    actions: ['pouring'],
    place: 'Panaji market',
    onScreenText: '₹40 CHAI',
    layout: 'closeup',
    colours: ['#5b3a29', '#8a5a3c', '#c98b4f', '#f4e1c1'],
  },
  {
    description: 'Busy street at night with neon shop signs and scooters passing',
    objects: ['street', 'neon sign', 'scooter', 'crowd'],
    actions: ['riding'],
    place: 'Mumbai',
    layout: 'city',
    colours: ['#141a33', '#2a2f5c', '#1d1d2b', '#ff4fa3'],
  },
  {
    description: 'Two friends laughing at a café table, handheld, warm window light',
    objects: ['people', 'coffee', 'table', 'window'],
    actions: ['talking', 'laughing', 'drinking'],
    place: null,
    layout: 'room',
    colours: ['#a8774f', '#d9b48a', '#6b4a33', '#ffe3b3'],
  },
  {
    description: 'Drone shot over green hills with a winding road and morning mist',
    objects: ['hills', 'road', 'mist', 'trees'],
    place: 'Western Ghats',
    layout: 'horizon',
    colours: ['#b9d3e6', '#e8eef2', '#3f6b3a', '#ffffff'],
  },
  {
    description: 'Plate of fish thali on a banana leaf, shot from above',
    objects: ['food', 'thali', 'banana leaf', 'rice'],
    place: null,
    onScreenText: 'BEST THALI IN GOA',
    layout: 'closeup',
    colours: ['#2f5d2a', '#4c8a3f', '#e8c35a', '#f6efe0'],
  },
  {
    description: 'Person walking towards the camera through a colourful market lane',
    objects: ['market', 'person', 'fabric', 'stalls'],
    actions: ['walking', 'shopping'],
    place: 'Mapusa market',
    layout: 'city',
    colours: ['#d9573b', '#f0a54a', '#5a3d6b', '#ffd34d'],
  },
  {
    description: 'Slow pan across a city skyline at blue hour, lights coming on',
    objects: ['skyline', 'buildings', 'lights'],
    place: 'Bandra',
    layout: 'city',
    colours: ['#27408b', '#6c7fc2', '#1b2140', '#ffd27a'],
  },
  {
    description: 'Laptop on a desk by a window, hands typing, plants in the background',
    objects: ['laptop', 'desk', 'plants', 'hands'],
    actions: ['working', 'typing'],
    place: null,
    onScreenText: 'DAY 3: EDITING',
    layout: 'room',
    colours: ['#d6d1c4', '#efebe2', '#7d6a55', '#5f8f5a'],
  },
  {
    description: 'Feet in shallow clear water over pebbles, slow motion',
    objects: ['water', 'feet', 'pebbles'],
    actions: ['wading'],
    place: null,
    layout: 'water',
    colours: ['#7cc4c9', '#bfe6e4', '#3b7f8a', '#f4f9f8'],
  },
  {
    description: 'Fireworks over a river, crowd silhouettes in the foreground',
    objects: ['fireworks', 'river', 'crowd'],
    actions: ['celebrating'],
    place: 'Mandovi river',
    layout: 'horizon',
    colours: ['#0d1026', '#1f2050', '#090912', '#ffb347'],
  },
  {
    description: 'Mountain trail at golden hour, a hiker looking out over the valley',
    objects: ['mountain', 'hiker', 'valley', 'sun'],
    actions: ['hiking'],
    place: 'Dudhsagar trail',
    layout: 'horizon',
    colours: ['#e38b3c', '#f5c27a', '#5c4632', '#fff0d1'],
  },
  {
    description: 'Dog running on wet sand chasing a ball, tracking shot',
    objects: ['dog', 'ball', 'sand', 'sea'],
    actions: ['running', 'playing'],
    place: 'Anjuna beach',
    layout: 'water',
    colours: ['#9fc3d6', '#dce9ee', '#c7a77b', '#f2d16b'],
  },
  {
    description: 'Rain on a car window with blurred city lights behind',
    objects: ['rain', 'window', 'lights'],
    place: null,
    layout: 'city',
    colours: ['#2b3440', '#4d5a68', '#1a2028', '#f5b14c'],
  },
  {
    description: 'Hands kneading dough on a floured wooden table',
    objects: ['dough', 'hands', 'flour', 'table'],
    actions: ['cooking', 'kneading dough'],
    place: null,
    layout: 'closeup',
    colours: ['#b38b5d', '#d9bf93', '#8c6a43', '#f7f1e3'],
  },
  {
    description: 'Talking to camera in a bedroom, ring light reflection in the eyes',
    objects: ['person', 'bedroom', 'ring light'],
    actions: ['talking'],
    place: null,
    layout: 'room',
    colours: ['#c9b8d9', '#e9e1f0', '#6d5a7d', '#fff5e6'],
  },
  {
    description: 'Ferry crossing a river, wide shot from the bank, gentle waves',
    objects: ['ferry', 'river', 'boat', 'trees'],
    place: 'Chorão island',
    layout: 'water',
    colours: ['#a7c6a0', '#dbe7d3', '#4b6f73', '#f0e6c8'],
  },
  {
    description: 'Ice cream cone held up against a bright blue sky',
    objects: ['ice cream', 'hand', 'sky'],
    place: null,
    onScreenText: 'TRY THIS',
    layout: 'closeup',
    colours: ['#4a90d9', '#a8d0f5', '#f2e2c4', '#f48fb1'],
  },
  {
    description: 'Concert crowd with hands in the air under purple stage lights',
    objects: ['crowd', 'stage', 'lights'],
    place: null,
    layout: 'city',
    colours: ['#3a1f5c', '#7a3fa0', '#120a1f', '#ff7ad9'],
  },
  {
    description: 'Snow-covered pine forest, slow push-in along a path',
    objects: ['snow', 'trees', 'path'],
    place: 'Manali',
    layout: 'horizon',
    colours: ['#dfe7ee', '#f5f8fa', '#5a6b5d', '#ffffff'],
  },
  {
    description: 'Coffee being made with a pour-over, steam rising, overhead',
    objects: ['coffee', 'kettle', 'cup', 'steam'],
    place: null,
    layout: 'closeup',
    colours: ['#3b2a20', '#5e4636', '#a07d5a', '#f3e4cf'],
  },
  {
    description: 'Cyclist riding past old Portuguese houses in bright colours',
    objects: ['bicycle', 'houses', 'street'],
    place: 'Fontainhas',
    layout: 'city',
    colours: ['#f2c14e', '#f7e3a3', '#d9663b', '#3d8fd1'],
  },
  {
    description: 'Sunrise over a calm lake, a single boat in the middle',
    objects: ['lake', 'boat', 'sunrise'],
    place: null,
    layout: 'water',
    colours: ['#f7a8a0', '#fde1c8', '#6a7f9e', '#fff4d6'],
  },
  {
    description: 'Unboxing a camera on a white desk, hands and packaging',
    objects: ['camera', 'box', 'hands', 'desk'],
    place: null,
    onScreenText: 'NEW GEAR',
    layout: 'room',
    colours: ['#e9e6e1', '#f7f5f2', '#9a948c', '#2d2d2d'],
  },
];

export interface SpokenLine {
  readonly language: 'en' | 'hi' | 'es' | 'pt-BR';
  readonly lines: readonly string[];
}

/** What people say in the clips that have speech, in the four v1 languages (decision D8). */
export const SPEECH: readonly SpokenLine[] = [
  {
    language: 'en',
    lines: [
      'Okay, we just landed in Goa and the light is honestly unreal.',
      'Let’s grab some chai before the sunset, this stall is famous.',
      'If you only do one thing here, do this walk at golden hour.',
      'I can’t believe how quiet the beach is this early.',
      'Save this for your trip, you will thank me later.',
    ],
  },
  {
    language: 'hi',
    lines: [
      'चलो, अब समुद्र तट पर चलते हैं, शाम बहुत सुंदर है।',
      'यह चाय सिर्फ़ चालीस रुपये की है और कमाल की है।',
      'आज हम बाज़ार में घूमेंगे और कुछ नया खाएँगे।',
      'यहाँ से सूरज डूबता हुआ सबसे अच्छा दिखता है।',
    ],
  },
  {
    language: 'es',
    lines: [
      'Mira qué bonito está el atardecer desde aquí.',
      'Este mercado es increíble, hay de todo.',
      'Vamos a probar el pescado, dicen que es el mejor.',
      'Guarda este vídeo para tu próximo viaje.',
    ],
  },
  {
    language: 'pt-BR',
    lines: [
      'Gente, olha essa vista, que coisa mais linda.',
      'Esse café da manhã aqui é simplesmente perfeito.',
      'Vem comigo conhecer a feira mais colorida da cidade.',
      'Salva esse vídeo pra sua próxima viagem.',
    ],
  },
];

export const FILE_PATTERNS: readonly ((n: number) => string)[] = [
  (n) => `IMG_${String(4000 + (n % 6000)).padStart(4, '0')}.MOV`,
  (n) =>
    `PXL_20260${(n % 9) + 1}${String(10 + (n % 18)).padStart(2, '0')}_${String(100000 + n).slice(-6)}.mp4`,
  (n) => `DJI_${String(n % 1000).padStart(4, '0')}.MP4`,
  (n) => `GX01${String(n % 10000).padStart(4, '0')}.MP4`,
  (n) => `IMG_${String(7000 + (n % 3000)).padStart(4, '0')}.HEIC`,
];
