// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the generated fixture library is about: ten themes, each with what a
 * vision model would say, what people say on camera in the four v1 languages,
 * on-screen text for some, and one search query per language whose relevant
 * shots are the theme's own. Synthetic: it stands in for the P2-Q1 labels
 * until people label the sample libraries.
 */
export const LANGUAGES = ['en', 'hi', 'es', 'pt-BR'] as const;
export type FixtureLanguage = (typeof LANGUAGES)[number];

export interface Theme {
  readonly key: string;
  readonly description: string;
  readonly objects: readonly string[];
  readonly place: string;
  readonly shotType: 'wide' | 'medium' | 'close';
  readonly motion: 'static' | 'pan' | 'handheld';
  readonly speech: Readonly<Record<FixtureLanguage, string>>;
  readonly onScreen?: string;
  readonly queries: Readonly<Record<FixtureLanguage, string>>;
}

export const THEMES: readonly Theme[] = [
  {
    key: 'beach-sunset',
    description: 'Golden sunset over the beach, waves rolling onto the sand',
    objects: ['sun', 'sea', 'sand', 'waves'],
    place: 'beach',
    shotType: 'wide',
    motion: 'pan',
    speech: {
      en: 'what a beautiful sunset on the beach tonight',
      hi: 'समुद्र तट पर सूर्यास्त कितना सुंदर है',
      es: 'qué atardecer tan bonito en la playa',
      'pt-BR': 'que pôr do sol lindo na praia',
    },
    queries: {
      en: 'sunset shots on the beach',
      hi: 'समुद्र तट पर सूर्यास्त',
      es: 'atardecer en la playa',
      'pt-BR': 'pôr do sol na praia',
    },
  },
  {
    key: 'beach-day',
    description: 'Kids playing in the sand on a sunny beach at noon',
    objects: ['kids', 'sand', 'bucket'],
    place: 'beach',
    shotType: 'medium',
    motion: 'handheld',
    speech: {
      en: 'the kids built a castle in the sand',
      hi: 'बच्चे बीच पर खेल रहे हैं',
      es: 'los niños juegan en la arena',
      'pt-BR': 'as crianças brincam na areia',
    },
    queries: {
      en: 'kids playing on the beach',
      hi: 'बीच पर बच्चे',
      es: 'niños en la playa',
      'pt-BR': 'crianças na praia',
    },
  },
  {
    key: 'city-night',
    description: 'Neon-lit city street at night with traffic',
    objects: ['car', 'neon sign', 'road'],
    place: 'city street',
    shotType: 'wide',
    motion: 'static',
    speech: {
      en: 'the city never sleeps at night',
      hi: 'रात में शहर जगमगाता है',
      es: 'la ciudad brilla de noche',
      'pt-BR': 'a cidade brilha à noite',
    },
    queries: {
      en: 'city street at night',
      hi: 'रात में शहर की सड़क',
      es: 'calle de la ciudad de noche',
      'pt-BR': 'rua da cidade à noite',
    },
  },
  {
    key: 'mountain-sunrise',
    description: 'Sunrise over snowy mountains',
    objects: ['mountain', 'snow', 'sky'],
    place: 'mountains',
    shotType: 'wide',
    motion: 'pan',
    speech: {
      en: 'sunrise over the mountains, look at the snow',
      hi: 'पहाड़ पर सूर्योदय और बर्फ',
      es: 'amanecer en la montaña con nieve',
      'pt-BR': 'nascer do sol na montanha com neve',
    },
    queries: {
      en: 'sunrise in the mountains',
      hi: 'पहाड़ पर सूर्योदय',
      es: 'amanecer en la montaña',
      'pt-BR': 'nascer do sol na montanha',
    },
  },
  {
    key: 'street-food',
    description: 'Street food sizzling on a griddle',
    objects: ['griddle', 'food', 'vendor'],
    place: 'food stall',
    shotType: 'close',
    motion: 'handheld',
    speech: {
      en: 'this street food smells amazing',
      hi: 'यह खाना बहुत स्वादिष्ट है',
      es: 'esta comida huele increíble',
      'pt-BR': 'essa comida cheira muito bem',
    },
    queries: {
      en: 'street food',
      hi: 'स्वादिष्ट खाना',
      es: 'comida callejera',
      'pt-BR': 'comida na chapa',
    },
  },
  {
    key: 'diwali',
    description: 'Diya lamps and fireworks at Diwali',
    objects: ['diya', 'fireworks', 'rangoli'],
    place: 'courtyard',
    shotType: 'medium',
    motion: 'static',
    onScreen: 'शुभ दीपावली',
    speech: {
      en: 'happy diwali everyone, look at the fireworks',
      hi: 'दिवाली पर दीये और आतिशबाजी',
      es: 'feliz diwali, mira los fuegos artificiales',
      'pt-BR': 'feliz diwali, olha os fogos de artifício',
    },
    queries: {
      en: 'diwali fireworks',
      hi: 'दिवाली के दीये',
      es: 'fuegos artificiales de diwali',
      'pt-BR': 'fogos de artifício no diwali',
    },
  },
  {
    key: 'wedding-dance',
    description: 'Guests dancing at a wedding',
    objects: ['people', 'lights', 'stage'],
    place: 'wedding hall',
    shotType: 'medium',
    motion: 'handheld',
    speech: {
      en: 'everyone is dancing at the wedding',
      hi: 'शादी में सब नाच रहे हैं',
      es: 'todos bailando en la boda',
      'pt-BR': 'todos dançando no casamento',
    },
    queries: {
      en: 'people dancing at a wedding',
      hi: 'शादी में नाच',
      es: 'baile en la boda',
      'pt-BR': 'dança no casamento',
    },
  },
  {
    key: 'dog-park',
    description: 'A dog running in the park',
    objects: ['dog', 'ball', 'grass'],
    place: 'park',
    shotType: 'wide',
    motion: 'pan',
    speech: {
      en: 'go get the ball, good dog',
      hi: 'कुत्ता पार्क में दौड़ रहा है',
      es: 'el perro corre en el parque',
      'pt-BR': 'o cachorro corre no parque',
    },
    queries: {
      en: 'dog running in the park',
      hi: 'पार्क में कुत्ता',
      es: 'perro en el parque',
      'pt-BR': 'cachorro no parque',
    },
  },
  {
    key: 'office',
    description: 'Laptop on a desk in a bright office',
    objects: ['laptop', 'desk', 'coffee'],
    place: 'office',
    shotType: 'close',
    motion: 'static',
    onScreen: 'Quarterly review',
    speech: {
      en: 'back at my desk in the office',
      hi: 'ऑफिस में काम चल रहा है',
      es: 'de vuelta en la oficina',
      'pt-BR': 'de volta ao escritório',
    },
    queries: {
      en: 'laptop on an office desk',
      hi: 'ऑफिस में लैपटॉप',
      es: 'trabajo en la oficina',
      'pt-BR': 'trabalho no escritório',
    },
  },
  {
    key: 'market',
    description: 'Busy vegetable market in the morning',
    objects: ['vegetables', 'crates', 'people'],
    place: 'market',
    shotType: 'wide',
    motion: 'handheld',
    onScreen: 'Fresh vegetables',
    speech: {
      en: 'fresh vegetables at the market',
      hi: 'सब्ज़ी बाज़ार में भीड़ है',
      es: 'verduras frescas en el mercado',
      'pt-BR': 'legumes frescos no mercado',
    },
    queries: {
      en: 'vegetable market',
      hi: 'सब्ज़ी बाज़ार',
      es: 'mercado de verduras',
      'pt-BR': 'mercado de legumes',
    },
  },
];
