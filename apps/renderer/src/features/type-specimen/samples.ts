// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* eslint-disable lingui/no-unlocalized-strings -- specimen text: data in two fixed scripts, never translated */

/*
 * What the specimen sets in each face: the app's own words where it has them (the Hindi comes from
 * src/locales/hi), in English and in Hindi whatever the app's language is, so every face is judged on the
 * same text. Numbers and dates are values, formatted by Intl in the sample's language.
 */

export interface SettingSample {
  readonly label: string;
  readonly hint: string;
  /** A value shown on the right (a choice, a length); a row without one has a switch. */
  readonly value?: string;
}

export interface Samples {
  readonly lang: 'en' | 'hi';
  readonly area: string;
  readonly detail: string;
  readonly importLabel: string;
  readonly section: string;
  readonly sectionCount: string;
  readonly sectionNote: string;
  readonly settings: readonly SettingSample[];
  readonly template: {
    readonly title: string;
    readonly meta: string;
    readonly more: string;
    readonly toCheck: string;
    readonly tags: readonly string[];
    readonly folder: string;
    readonly trend: string;
    readonly changed: string;
  };
  readonly prose: readonly string[];
  readonly figures: readonly {
    readonly label: string;
    readonly value: number;
    readonly style: 'count' | 'usd' | 'gb';
  }[];
  readonly timecodeHeading: string;
  readonly timecodes: readonly { readonly label: string; readonly value: string }[];
  readonly buttons: {
    readonly primary: string;
    readonly secondary: string;
    readonly ghost: string;
    readonly undo: string;
  };
  readonly display: string;
  readonly headline: string;
  readonly weightLine: string;
}

export const EN: Samples = {
  lang: 'en',
  area: 'Templates',
  detail: 'Golden hour market',
  importLabel: 'Import…',
  section: 'Your templates',
  sectionCount: '3 templates',
  sectionNote: 'Templates you made from reels, and the ones you copied from the hub.',
  settings: [
    {
      label: 'Interface sounds',
      hint: 'A soft click when a clip lands on the beat, and a chime when an export finishes.',
    },
    {
      label: 'How Taalcut thinks',
      hint: 'Good results at a fair price. Right for most videos.',
      value: 'Everyday',
    },
    {
      label: 'Keep exports for',
      hint: 'Older exports move to the Bin. Your clips are never deleted.',
      value: '30 days',
    },
  ],
  template: {
    title: 'Golden hour market',
    meta: '12 slots · 15s · 120 BPM',
    more: 'Instagram Reels · English',
    toCheck: '10 slots not approved',
    tags: ['travel', 'golden-hour'],
    folder: 'Travel',
    trend: 'Trend Sep 28',
    changed: 'Changed Oct 11',
  },
  prose: [
    'I broke the reel into 12 beats. It opens on a wide shot for under a second, then cuts on every kick until the drop at 0:09, where it holds one slow push-in for three beats.',
    'From your Goa trip I took the sunset over the market for the opening: the same warm light and a clean horizon. The middle eight are your busiest street shots, ordered so the movement keeps going left to right.',
    'Two slots are weaker. Slot 7 wants a face, and your clips there are hands and food; slot 11 is a 0.4 s hit and the best match is a little soft. Swap them, or approve and I’ll export it at 1080 × 1920.',
  ],
  figures: [
    { label: 'Requests', value: 1284, style: 'count' },
    { label: 'Tokens', value: 2_418_560, style: 'count' },
    { label: 'Cost this month', value: 3.18, style: 'usd' },
    { label: 'Library', value: 4.5, style: 'gb' },
  ],
  timecodeHeading: 'Timecode',
  timecodes: [
    { label: 'Playhead', value: '00:00:12:08' },
    { label: 'Shot starts', value: '0:09.40' },
    { label: 'Exporting', value: '1:24 / 2:10' },
  ],
  buttons: { primary: 'Export video', secondary: 'Swap clip', ghost: 'Cancel', undo: 'Undo' },
  display: 'Your video is ready.',
  headline: 'Where do your videos live?',
  weightLine: 'Good results at a fair price. Right for most videos, 0–9.',
};

export const HI: Samples = {
  lang: 'hi',
  area: 'टेम्पलेट',
  detail: 'सुनहरी शाम का बाज़ार',
  importLabel: 'इम्पोर्ट करें…',
  section: 'आपके टेम्पलेट',
  sectionCount: '3 टेम्पलेट',
  sectionNote: 'रील से आपके बनाए टेम्पलेट, और हब से कॉपी किए गए टेम्पलेट।',
  settings: [
    {
      label: 'इंटरफ़ेस की आवाज़ें',
      hint: 'क्लिप बीट पर बैठे तो हल्की-सी क्लिक, और एक्सपोर्ट पूरा होने पर एक घंटी।',
    },
    {
      label: 'Taalcut कैसे सोचे',
      hint: 'सही दाम में अच्छे नतीजे। ज़्यादातर वीडियो के लिए सही।',
      value: 'रोज़मर्रा',
    },
    {
      label: 'एक्सपोर्ट कब तक रखें',
      hint: 'पुराने एक्सपोर्ट Bin में चले जाते हैं। आपकी क्लिप कभी नहीं मिटतीं।',
      value: '30 दिन',
    },
  ],
  template: {
    title: 'सुनहरी शाम का बाज़ार',
    meta: '12 स्लॉट · 15s · 120 BPM',
    more: 'Instagram Reels · हिन्दी',
    toCheck: '10 स्लॉट जाँचने बाकी',
    tags: ['यात्रा', 'सुनहरी-शाम'],
    folder: 'यात्रा',
    trend: 'ट्रेंड 28 सित॰',
    changed: 'बदला 11 अक्टू॰',
  },
  prose: [
    'मैंने रील को 12 बीट में बाँटा है। यह एक सेकंड से कम के वाइड शॉट से खुलती है, फिर हर किक पर कट होता है, 0:09 के ड्रॉप तक, जहाँ एक धीमा पुश-इन तीन बीट तक टिका रहता है।',
    'शुरुआत के लिए मैंने आपकी गोवा ट्रिप से बाज़ार पर डूबता सूरज लिया: वही गर्म रोशनी और साफ़ क्षितिज। बीच के आठ शॉट आपकी सबसे भीड़ वाली गलियों के हैं, इस क्रम में कि हलचल बाएँ से दाएँ चलती रहे।',
    'दो स्लॉट कमज़ोर हैं। स्लॉट 7 में चेहरा चाहिए, और वहाँ आपकी क्लिप में हाथ और खाना है; स्लॉट 11 सिर्फ़ 0.4 s का है और सबसे अच्छा मेल थोड़ा धुँधला है। इन्हें बदलें, या मंज़ूरी दें और मैं इसे 1080 × 1920 में एक्सपोर्ट कर दूँगा।',
  ],
  figures: [
    { label: 'अनुरोध', value: 1284, style: 'count' },
    { label: 'टोकन', value: 2_418_560, style: 'count' },
    { label: 'इस महीने का ख़र्च', value: 3.18, style: 'usd' },
    { label: 'लाइब्रेरी', value: 4.5, style: 'gb' },
  ],
  timecodeHeading: 'टाइमकोड',
  timecodes: [
    { label: 'प्लेहेड', value: '00:00:12:08' },
    { label: 'शॉट शुरू', value: '0:09.40' },
    { label: 'एक्सपोर्ट हो रहा है', value: '1:24 / 2:10' },
  ],
  buttons: {
    primary: 'वीडियो एक्सपोर्ट करें',
    secondary: 'क्लिप बदलें',
    ghost: 'रद्द करें',
    undo: 'पहले जैसा करें',
  },
  display: 'आपका वीडियो तैयार है।',
  headline: 'आपके वीडियो कहाँ रहते हैं?',
  weightLine: 'सही दाम में अच्छे नतीजे। ज़्यादातर वीडियो के लिए सही, 0–9।',
};

/** One line of someone's own words with a phrase in another script, as a clip or template name would carry it. */
export interface ScriptLine {
  /** BCP 47 language of the phrase; Intl names it in the reader's language. */
  readonly lang: string;
  /** ISO 15924 script code. */
  readonly script: string;
  readonly phrase: string;
  /** The face that draws the phrase: shipped, or the system's own. */
  readonly drawnBy: string;
}

/** The phrase is "golden hour market" in each language; the English around it is the same on every line. */
export const SCRIPT_LINES: readonly ScriptLine[] = [
  { lang: 'hi', script: 'Deva', phrase: 'सुनहरी शाम का बाज़ार', drawnBy: 'Noto Sans Devanagari' },
  { lang: 'bn', script: 'Beng', phrase: 'সোনালি সন্ধ্যার বাজার', drawnBy: 'Noto Sans Bengali' },
  { lang: 'ta', script: 'Taml', phrase: 'பொன்மாலை சந்தை', drawnBy: 'Noto Sans Tamil' },
  { lang: 'ar', script: 'Arab', phrase: 'سوق الساعة الذهبية', drawnBy: 'Noto Sans Arabic' },
  { lang: 'el', script: 'Grek', phrase: 'Αγορά της χρυσής ώρας', drawnBy: 'Noto Sans' },
  { lang: 'gu', script: 'Gujr', phrase: 'સોનેરી સાંજનું બજાર', drawnBy: 'Noto Sans Gujarati' },
  { lang: 'pa', script: 'Guru', phrase: 'ਸੁਨਹਿਰੀ ਸ਼ਾਮ ਦਾ ਬਾਜ਼ਾਰ', drawnBy: 'Noto Sans Gurmukhi' },
  { lang: 'kn', script: 'Knda', phrase: 'ಚಿನ್ನದ ಸಂಜೆಯ ಮಾರುಕಟ್ಟೆ', drawnBy: 'Noto Sans Kannada' },
  { lang: 'ml', script: 'Mlym', phrase: 'സ്വർണ്ണ സന്ധ്യയുടെ ചന്ത', drawnBy: 'Noto Sans Malayalam' },
  { lang: 'or', script: 'Orya', phrase: 'ସୁନେଲି ସନ୍ଧ୍ୟାର ବଜାର', drawnBy: 'Noto Sans Oriya' },
  { lang: 'te', script: 'Telu', phrase: 'బంగారు సాయంత్రం బజారు', drawnBy: 'Noto Sans Telugu' },
  { lang: 'he', script: 'Hebr', phrase: 'שוק שעת הזהב', drawnBy: 'Noto Sans Hebrew' },
  { lang: 'th', script: 'Thai', phrase: 'ตลาดยามเย็นสีทอง', drawnBy: 'Noto Sans Thai' },
  { lang: 'ru', script: 'Cyrl', phrase: 'Рынок золотого часа', drawnBy: 'Onest' },
  { lang: 'vi', script: 'Latn', phrase: 'Chợ giờ vàng', drawnBy: 'Onest' },
  { lang: 'ja', script: 'Jpan', phrase: 'ゴールデンアワーの市場', drawnBy: 'system' },
  { lang: 'zh', script: 'Hans', phrase: '黄金时刻的集市', drawnBy: 'system' },
];

/** The English the phrases sit between, as in a clip's name and its facts. */
export const SCRIPT_LINE_LEAD = 'Golden hour market';
export const SCRIPT_LINE_TAIL = '12 slots · 0:15';

/** The type roles, largest first, as roles.css names them (headline and display are in the brand sample). */
export const ROLES = [
  'type-page-title',
  'type-section',
  'type-card-title',
  'type-prose',
  'type-body',
  'type-label',
  'type-label-sm',
  'type-data',
  'type-meta',
  'type-caption',
] as const;

export type Role = (typeof ROLES)[number];

/** A few words each role carries in the app, in English and Hindi. */
export const ROLE_WORDS: Record<Role, { readonly en: string; readonly hi: string }> = {
  'type-page-title': { en: 'Templates', hi: 'टेम्पलेट' },
  'type-section': { en: 'Your templates', hi: 'आपके टेम्पलेट' },
  'type-card-title': { en: 'Golden hour market', hi: 'सुनहरी शाम का बाज़ार' },
  'type-prose': { en: 'I broke the reel into 12 beats.', hi: 'मैंने रील को 12 बीट में बाँटा है।' },
  'type-body': { en: 'Good results at a fair price.', hi: 'सही दाम में अच्छे नतीजे।' },
  'type-label': { en: 'Export video', hi: 'वीडियो एक्सपोर्ट करें' },
  'type-label-sm': { en: 'Swap clip', hi: 'क्लिप बदलें' },
  'type-data': { en: '1,284 · 4.5 GB', hi: '1,284 · 4.5 GB' },
  'type-meta': { en: '12 slots · 15s · 120 BPM', hi: '12 स्लॉट · 15s · 120 BPM' },
  'type-caption': { en: 'golden-hour', hi: 'सुनहरी-शाम' },
};
