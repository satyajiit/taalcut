// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The words a reference to a place in a video is made of, in the four v1 languages (English, Hindi, Spanish,
 * Brazilian Portuguese, D8): number words, ordinals, what a slot is called, units of time, range words and the
 * words that say which video is meant. Model-facing parsing data, not user-facing copy.
 */

/** "a|b c|d" → ['a', 'b c', 'd']: compact lists of words and phrases. */
const phrases = (list: string): readonly string[] => list.split('|');

function table(rows: readonly (readonly [number, string])[]): Readonly<Record<string, number>> {
  return Object.fromEntries(rows.flatMap(([value, words]) => phrases(words).map((word) => [word, value])));
}

/** Cardinal number words, 0–20 and the tens to 60 (a short video's seconds), in en, es, pt-BR and hi. */
export const NUMBER_WORDS = table([
  [0, 'zero|cero|शून्य'],
  [1, 'one|uno|una|um|uma|एक'],
  [2, 'two|dos|dois|duas|दो'],
  [3, 'three|tres|três|तीन'],
  [4, 'four|cuatro|quatro|चार'],
  [5, 'five|cinco|पाँच|पांच'],
  [6, 'six|seis|छह|छः'],
  [7, 'seven|siete|sete|सात'],
  [8, 'eight|ocho|oito|आठ'],
  [9, 'nine|nueve|nove|नौ'],
  [10, 'ten|diez|dez|दस'],
  [11, 'eleven|once|onze|ग्यारह'],
  [12, 'twelve|doce|doze|बारह'],
  [13, 'thirteen|trece|treze|तेरह'],
  [14, 'fourteen|catorce|quatorze|catorze|चौदह'],
  [15, 'fifteen|quince|quinze|पंद्रह'],
  [16, 'sixteen|dieciséis|dezesseis|सोलह'],
  [17, 'seventeen|diecisiete|dezessete|सत्रह'],
  [18, 'eighteen|dieciocho|dezoito|अठारह'],
  [19, 'nineteen|diecinueve|dezenove|उन्नीस'],
  [20, 'twenty|veinte|vinte|बीस'],
  [30, 'thirty|treinta|trinta|तीस'],
  [40, 'forty|cuarenta|quarenta|चालीस'],
  [50, 'fifty|cincuenta|cinquenta|पचास'],
  [60, 'sixty|sesenta|sessenta|साठ'],
]);

/** The last slot. */
export const LAST = -1;

/** Ordinal words to a 1-based position; LAST for "last". Gendered and Hindi oblique forms included. */
export const ORDINAL_WORDS = table([
  [1, 'first|primer|primero|primera|primeiro|primeira|पहला|पहली|पहले'],
  [2, 'second|segundo|segunda|दूसरा|दूसरी|दूसरे'],
  [3, 'third|tercer|tercero|tercera|terceiro|terceira|तीसरा|तीसरी|तीसरे'],
  [4, 'fourth|cuarto|cuarta|quarto|quarta|चौथा|चौथी|चौथे'],
  [5, 'fifth|quinto|quinta|पाँचवाँ|पांचवां|पाँचवीं|पांचवीं|पाँचवें|पांचवें'],
  [6, 'sixth|sexto|sexta|छठा|छठी|छठे'],
  [7, 'seventh|séptimo|séptima|sétimo|sétima|सातवाँ|सातवां|सातवीं|सातवें'],
  [8, 'eighth|octavo|octava|oitavo|oitava|आठवाँ|आठवां|आठवीं|आठवें'],
  [9, 'ninth|noveno|novena|nono|nona|नौवाँ|नौवां|नौवीं'],
  [10, 'tenth|décimo|décima|दसवाँ|दसवां|दसवीं'],
  [LAST, 'last|final|último|última|आखिरी|आख़िरी|अंतिम'],
]);

/** What a slot (shot, clip, cut) is called. "corte" is a clip in Portuguese and Spanish editing talk. */
export const SLOT_NOUNS = phrases(
  'slot|shot|clip|scene|cut|toma|plano|escena|corte|clipe|cena|tomada|trecho|स्लॉट|शॉट|क्लिप|सीन|कट|दृश्य',
);

/** The first slot by its job. */
export const HOOK_WORDS = phrases(
  'the hook|the opening|the intro|el gancho|la apertura|la entrada|o gancho|a abertura|a introdução|हुक|शुरुआत',
);

/** Seconds as a unit after a number ("4 s", "4 sec", "4 segundos", "4 सेकंड"). */
export const SECOND_UNITS = phrases('seconds|second|secs|sec|s|segundos|segundo|seg|सेकंड|सेकेंड|सेकण्ड');

/** "segundo 8", "second 8": a unit before the number (Spanish and Portuguese say it this way). */
export const SECOND_PREFIXES = phrases('segundo|second');

/** Words that open a range and join its two ends; Hindi closes it after the second end ("0:03 से 0:06 तक"). */
export const RANGE_STARTS = phrases('from|between|de|desde|entre|do|da');
export const RANGE_JOINS = phrases('to|and|until|till|a|y|e|até|hasta|से|-|–|—');
export const RANGE_ENDS = phrases('तक');

/**
 * A spoken time is a place, not a length, only after one of these ("at 4 seconds", "a los 4 segundos", "aos 4
 * segundos") or, in Hindi, before one ("4 सेकंड पर"); "make it 2 seconds shorter" points at nothing.
 */
export const POSITION_BEFORE = phrases(
  'at|around|near|about|a los|a las|al|en el|hacia|cerca de|aos|ao|nos|no|em|perto de|por volta de',
);
export const POSITION_AFTER = phrases('पर|के आसपास|में');

/** A cut between slots, rather than a slot. */
export const TRANSITION_WORDS = phrases(
  'transition|transitions|cut at|cuts at|the cut|transición|transiciones|el corte|transição|transições|o corte|ट्रांज़िशन|ट्रांजिशन|कट',
);

/** Words that name the reference (the template). */
export const TEMPLATE_WORDS = phrases(
  'reference|original|their|the template|the reel|the example|referencia|plantilla|el de ellos|la de ellos|referência|modelo|template|deles|delas|रेफरेंस|रेफ़रेंस|ओरिजिनल|टेम्पलेट|उनका|उनकी',
);

/** Words that name the user's own video (the timeline). */
export const TIMELINE_WORDS = phrases(
  'my video|my draft|my edit|my version|my cut|mine|mi video|mi vídeo|mi borrador|mi edición|el mío|la mía|meu vídeo|meu video|meu rascunho|minha edição|minha versão|o meu|a minha|मेरा वीडियो|मेरी वीडियो|मेरा ड्राफ्ट|मेरा',
);

/** Copy and match verbs point at the template. */
export const COPY_WORDS = phrases(
  'copy|same as|match|like the|copia|copiar|copie|igual que|igual a|igual ao|como el|como la|como o|como a|कॉपी|जैसा|जैसी|जैसे',
);

/** Edit verbs point at the timeline. */
export const EDIT_WORDS = phrases(
  'cut|trim|swap|shorter|longer|replace|change|remove|delete|move|make|brighter|darker|too dark|too long|corta|recorta|acorta|cambia|reemplaza|quita|mueve|más corto|más largo|apara|encurta|troca|troque|substitui|muda|mude|remova|tira|mais curto|mais longo|काट|छोटा|बदल|हटा|लंबा',
);

/** Devanagari digits read as ASCII digits (one character each, so text offsets stay put). */
export function asciiDigits(text: string): string {
  return text.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));
}

/** A number written as digits or as one of NUMBER_WORDS; undefined otherwise. */
export function readNumber(word: string): number | undefined {
  const plain = word.trim().replace(',', '.');
  if (/^\d+(?:\.\d+)?$/.test(plain)) return Number(plain);
  return NUMBER_WORDS[plain.toLowerCase()];
}
