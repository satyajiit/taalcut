// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Spoken numbers in the four v1 languages (D8), so an anchor phrase written with digits matches the words
 * someone said ("50 %" = "fifty percent" = "cincuenta por ciento" = "पचास प्रतिशत"). Data only: words are
 * already lower case, Latin diacritics stripped (phrase-match.ts normalises the same way), Devanagari without
 * nukta and with ँ as ं.
 */

/** A word's value, and whether it multiplies what came before it (hundred, thousand). */
export interface NumberWord {
  readonly value: number;
  readonly scale?: true;
}

const units = (words: readonly (string | readonly string[])[], from = 0) =>
  words.flatMap((entry, index) =>
    (typeof entry === 'string' ? [entry] : entry).map((word) => [word, from + index] as const),
  );

const EN: [string, NumberWord][] = [
  ...units(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']),
  ...units(
    ['eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'],
    11,
  ),
  ...units(['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']).map(
    ([word, index]) => [word, (index + 2) * 10] as const,
  ),
].map(([word, value]) => [word, { value }]);

const ES: [string, NumberWord][] = [
  ...units([
    'cero',
    ['uno', 'un', 'una'],
    'dos',
    'tres',
    'cuatro',
    'cinco',
    'seis',
    'siete',
    'ocho',
    'nueve',
    'diez',
  ]),
  ...units(
    ['once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve'],
    11,
  ),
  ...units(
    [
      'veinte',
      ['veintiuno', 'veintiun', 'veintiuna'],
      'veintidos',
      'veintitres',
      'veinticuatro',
      'veinticinco',
      'veintiseis',
      'veintisiete',
      'veintiocho',
      'veintinueve',
    ],
    20,
  ),
  ...units(['treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']).map(
    ([word, index]) => [word, (index + 3) * 10] as const,
  ),
].map(([word, value]) => [word, { value }]);

const PT: [string, NumberWord][] = [
  ...units([
    'zero',
    ['um', 'uma'],
    ['dois', 'duas'],
    'tres',
    'quatro',
    'cinco',
    'seis',
    'sete',
    'oito',
    'nove',
    'dez',
  ]),
  ...units(
    [
      'onze',
      'doze',
      'treze',
      ['catorze', 'quatorze'],
      'quinze',
      ['dezesseis', 'dezasseis'],
      ['dezessete', 'dezassete'],
      'dezoito',
      ['dezenove', 'dezanove'],
    ],
    11,
  ),
  ...units(['vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']).map(
    ([word, index]) => [word, (index + 2) * 10] as const,
  ),
].map(([word, value]) => [word, { value }]);

/** Hindi has its own word for every number to a hundred. */
const HI_0_TO_100 = [
  'शून्य',
  'एक',
  'दो',
  'तीन',
  'चार',
  ['पांच', 'पाच'],
  ['छह', 'छः', 'छे'],
  'सात',
  'आठ',
  'नौ',
  'दस',
  'ग्यारह',
  'बारह',
  'तेरह',
  'चौदह',
  ['पंद्रह', 'पन्द्रह'],
  'सोलह',
  'सत्रह',
  'अठारह',
  'उन्नीस',
  'बीस',
  'इक्कीस',
  'बाईस',
  'तेईस',
  'चौबीस',
  'पच्चीस',
  'छब्बीस',
  'सत्ताईस',
  'अट्ठाईस',
  'उनतीस',
  'तीस',
  'इकतीस',
  'बत्तीस',
  'तैंतीस',
  'चौंतीस',
  'पैंतीस',
  'छत्तीस',
  'सैंतीस',
  'अडतीस',
  'उनतालीस',
  'चालीस',
  'इकतालीस',
  'बयालीस',
  'तैंतालीस',
  'चवालीस',
  'पैंतालीस',
  'छियालीस',
  'सैंतालीस',
  'अडतालीस',
  'उनचास',
  'पचास',
  'इक्यावन',
  'बावन',
  'तिरपन',
  'चौवन',
  'पचपन',
  'छप्पन',
  'सत्तावन',
  'अट्ठावन',
  'उनसठ',
  'साठ',
  'इकसठ',
  'बासठ',
  'तिरसठ',
  'चौंसठ',
  'पैंसठ',
  'छियासठ',
  'सडसठ',
  'अडसठ',
  'उनहत्तर',
  'सत्तर',
  'इकहत्तर',
  'बहत्तर',
  'तिहत्तर',
  'चौहत्तर',
  'पचहत्तर',
  'छिहत्तर',
  'सतहत्तर',
  'अठहत्तर',
  'उन्यासी',
  'अस्सी',
  'इक्यासी',
  'बयासी',
  'तिरासी',
  'चौरासी',
  'पचासी',
  'छियासी',
  'सत्तासी',
  'अट्ठासी',
  'नवासी',
  'नब्बे',
  'इक्यानवे',
  'बानवे',
  'तिरानवे',
  'चौरानवे',
  'पचानवे',
  'छियानवे',
  'सत्तानवे',
  'अट्ठानवे',
  'निन्यानवे',
  'सौ',
] as const;
const HI: [string, NumberWord][] = units(HI_0_TO_100).map(([word, value]) => [word, { value }]);

/** Spanish and Portuguese name their hundreds; they add like tens ("doscientos cincuenta"). */
const HUNDREDS: [string, NumberWord][] = (
  [
    ['doscientos', 200],
    ['trescientos', 300],
    ['cuatrocientos', 400],
    ['quinientos', 500],
    ['seiscientos', 600],
    ['setecientos', 700],
    ['ochocientos', 800],
    ['novecientos', 900],
    ['duzentos', 200],
    ['trezentos', 300],
    ['quatrocentos', 400],
    ['quinhentos', 500],
    ['seiscentos', 600],
    ['setecentos', 700],
    ['oitocentos', 800],
    ['novecentos', 900],
  ] as const
).map(([word, value]) => [word, { value }]);

const SCALES: [string, NumberWord][] = (
  [
    ['hundred', 100],
    ['thousand', 1000],
    ['million', 1_000_000],
    ['cien', 100],
    ['ciento', 100],
    ['cientos', 100],
    ['mil', 1000],
    ['millon', 1_000_000],
    ['millones', 1_000_000],
    ['cem', 100],
    ['cento', 100],
    ['milhao', 1_000_000],
    ['milhoes', 1_000_000],
    ['सौ', 100],
    ['हजार', 1000],
    ['लाख', 100_000],
    ['करोड', 10_000_000],
  ] as const
).map(([word, value]) => [word, { value, scale: true }]);

/** Every number word of the four languages (a word means the same number wherever it appears). */
export const NUMBER_WORDS: ReadonlyMap<string, NumberWord> = new Map([
  ...EN,
  ...ES,
  ...PT,
  ...HI,
  ...HUNDREDS,
  ...SCALES,
]);

/** Words that join number words ("one hundred and five", "treinta y cinco", "vinte e cinco"). */
export const NUMBER_JOINERS: ReadonlySet<string> = new Set(['and', 'y', 'e']);

/** Ways of saying "per cent", already split into words; each becomes '%'. */
export const PERCENT_PHRASES: readonly (readonly string[])[] = [
  ['percent'],
  ['per', 'cent'],
  ['percentage'],
  ['por', 'ciento'],
  ['por', 'cento'],
  ['प्रतिशत'],
  ['फीसदी'],
  ['फीसद'],
];
