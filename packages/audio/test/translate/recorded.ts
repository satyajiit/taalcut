// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Recorded translations of the test captions (captions.ts), by target language and source unit text, as the
 * agent chain returned them. `shorter:` entries answer the shorter pass.
 */
export const RECORDED_TRANSLATIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  hi: {
    'So today I want to show you my morning routine.': 'आज मैं आपको अपनी सुबह की दिनचर्या दिखाना चाहता हूँ।',
    'It takes ten minutes and it changed my whole week.':
      'इसमें दस मिनट लगते हैं और इसने मेरा पूरा हफ़्ता बदल दिया।',
    "Let's start with coffee!": 'चलिए कॉफ़ी से शुरू करते हैं!',
  },
  es: {
    'So today I want to show you my morning routine.': 'Hoy quiero mostrarte mi rutina de la mañana.',
    'It takes ten minutes and it changed my whole week.': 'Tarda diez minutos y cambió toda mi semana.',
    "Let's start with coffee!": '¡Empecemos con café!',
  },
  'pt-BR': {
    'So today I want to show you my morning routine.': 'Hoje eu quero te mostrar minha rotina matinal.',
    'It takes ten minutes and it changed my whole week.': 'Leva dez minutos e mudou minha semana inteira.',
    "Let's start with coffee!": 'Vamos começar com café!',
  },
  en: {
    'Hoy quiero mostrarte mi rutina.': 'Today I want to show you my routine.',
    '¡Empecemos con café!': "Let's start with coffee!",
  },
};
