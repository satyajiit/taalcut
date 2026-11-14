// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a month of videos costs (the owner, 2026-11-06; SPEC.md › WEB3 truth ledger, Cost). Three prices are typed here
 * and nowhere else: a video editor you hire, about US$5,000 a month (the owner's figure; the US median for film and video editors was
 * $75,420 a year in May 2025, about $6,285 a month, before an employer's costs); Taalcut with a cloud AI at 3–4 videos a day, about
 * US$500 a month, which is the bill from the AI the user brings (their ChatGPT plan or API keys), never a Taalcut price;
 * and Taalcut all on the computer (on-device models), nearly US$0. Every saving and every change below is computed from
 * them, and the site prints only what these functions write. claims.ts allows a percentage only where it is one of
 * COST_CHANGES as change() writes it (a minus sign, the number, the per cent sign); test/unit/cost.test.ts holds both.
 */

export type CostId = 'editor' | 'cloud' | 'local';
/** How exact a price is: the owner's round figure ("about"), or a figure a little above it ("nearly"). */
export type Approx = 'about' | 'nearly';
export type CostPeriod = 'month' | 'year';

export interface CostOption {
  readonly id: CostId;
  readonly name: string;
  /** One line under the name: what the money pays for. */
  readonly line: string;
  /** US dollars a month: the owner's figure. */
  readonly usd: number;
  readonly approx: Approx;
}

/** The three ways to make 3–4 videos a day, the hired editor first: every saving is measured from it. */
export const COST_OPTIONS: readonly [CostOption, CostOption, CostOption] = [
  { id: 'editor', name: 'A video editor you hire', line: 'Paid by the month to cut your videos.', usd: 5000, approx: 'about' },
  {
    id: 'cloud',
    name: 'Taalcut with a cloud AI',
    line: 'Taalcut is free. This is your AI’s bill, on your ChatGPT plan or API keys.',
    usd: 500,
    approx: 'about',
  },
  {
    id: 'local',
    name: 'Taalcut, all on your computer',
    line: 'Every job on your computer’s own models. Lower quality, and no AI voice or images.',
    usd: 0,
    approx: 'nearly',
  },
];

/** How many videos a day the prices are for (the owner's basis). */
export const VIDEOS_A_DAY = '3–4';

const MONTHS: Readonly<Record<CostPeriod, number>> = { month: 1, year: 12 };
const PER: Readonly<Record<CostPeriod, string>> = { month: 'a month', year: 'a year' };

export function costOption(id: CostId): CostOption {
  const found = COST_OPTIONS.find((o) => o.id === id);
  if (!found) throw new Error(`No cost option ${id}`);
  return found;
}

const BASELINE = COST_OPTIONS[0];

/** A price over a period: the amount in US dollars and how exact it is. */
export function price(id: CostId, period: CostPeriod): { readonly usd: number; readonly approx: Approx } {
  const o = costOption(id);
  return { usd: o.usd * MONTHS[period], approx: o.approx };
}

export interface Saving {
  /** US dollars less than the hired editor over the period. */
  readonly usd: number;
  /** "about" when the price it comes from is only nearly what it says (nearly $0 leaves about $5,000). */
  readonly approx: 'about' | null;
  /** The change against the editor, in whole per cent, rounded: 90 for $5,000 → $500. */
  readonly percent: number;
  /** "nearly" when the price is nearly zero: the change is nearly −100 %. */
  readonly percentApprox: 'nearly' | null;
}

/** What one of Taalcut's two ways saves against hiring an editor, over a period. */
export function saving(id: Exclude<CostId, 'editor'>, period: CostPeriod): Saving {
  const o = costOption(id);
  const less = BASELINE.usd - o.usd;
  const near = o.approx === 'nearly';
  return {
    usd: less * MONTHS[period],
    approx: near ? 'about' : null,
    percent: Math.round((less / BASELINE.usd) * 100),
    percentApprox: near ? 'nearly' : null,
  };
}

const DOLLARS = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** US dollars as the site writes them: $5,000. */
export function usd(amount: number): string {
  return DOLLARS.format(amount);
}

/** The minus sign a change is written with (U+2212), never a hyphen. */
export const MINUS = '\u2212';

/** A fall in whole per cent: −90%. The only way the site writes a percentage. */
export function change(percent: number): string {
  return `${MINUS}${percent}%`;
}

/** Every change the site may print: the two savings' per cents, computed. claims.ts reads it. */
export const COST_CHANGES: readonly number[] = (['cloud', 'local'] as const).map((id) => saving(id, 'month').percent);

const qualified = (approx: string | null, words: string) => (approx ? `${approx} ${words}` : words);
const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/** "a month" or "a year". */
export function per(period: CostPeriod): string {
  return PER[period];
}

/** A price in words: "about $500", "nearly $0". */
export function priceWords(id: CostId, period: CostPeriod): string {
  const p = price(id, period);
  return qualified(p.approx, usd(p.usd));
}

/** A saving in words: "$4,500 a month back", "about $5,000 a month back" (or "… less"). */
export function backWords(id: Exclude<CostId, 'editor'>, period: CostPeriod, tail: 'back' | 'less' = 'back'): string {
  const s = saving(id, period);
  return qualified(s.approx, `${usd(s.usd)} ${per(period)} ${tail}`);
}

/** A change in words: "−90%", "nearly −100%". */
export function changeWords(id: Exclude<CostId, 'editor'>): string {
  const s = saving(id, 'month');
  return qualified(s.percentApprox, change(s.percent));
}

/** The section's words. */
export const COST_SECTION = {
  id: 'cost',
  heading: 'What a month of videos costs',
  lead: 'Taalcut is free, and using it needs no Taalcut cloud. What you pay is your AI’s bill: your ChatGPT plan or API keys, or nearly nothing when the AI runs on your computer.',
  /** The board's heading line: what the figures are for. */
  basis: (period: CostPeriod) => `${capital(per(period))} at ${VIDEOS_A_DAY} videos a day`,
  currency: 'In US dollars',
  /** The period switch: its group's name and its two choices. */
  periods: { group: 'Show the cost for', month: 'A month', year: 'A year' } satisfies Record<'group' | CostPeriod, string>,
  /** The Local only setting, by its name in the app (Settings › Privacy). */
  localOnly: 'Local only',
  replay: 'Play the comparison again',
  /** The facts beside the board: the saving each way, against hiring. */
  savingLine: (id: Exclude<CostId, 'editor'>, period: CostPeriod) =>
    `${capital(backWords(id, period))} ${id === 'cloud' ? 'with a cloud AI' : 'all on your computer'}, ${changeWords(id)} against hiring.`,
  link: 'Bring your own AI',
  /** /ai/'s section, where the visitor chooses cloud or local. */
  ai: {
    heading: 'What each choice costs',
    lead: `Taalcut is free, so what you pay is your AI’s bill: your own plan or API keys for a cloud AI, and nearly nothing for the AI on your computer. Here are both against an editor you hire, at ${VIDEOS_A_DAY} videos a day.`,
    /** The facts beside the board, each with its label. */
    facts: (period: CostPeriod) =>
      [
        ['With a cloud AI', `${capital(backWords('cloud', period))} against hiring, ${changeWords('cloud')}. The bill comes from your ChatGPT plan or API keys, never from Taalcut.`],
        ['All on your computer', `${capital(backWords('local', period))} against hiring, ${changeWords('local')}. Lower quality, and no AI voice or images.`],
      ] as const,
  },
} as const;

/** The comparison in sentences: the FAQ's cost answer, its JSON-LD and llms-full.txt print it. */
export function costInWords(): string {
  const editor = costOption('editor');
  return [
    `At ${VIDEOS_A_DAY} videos a day, ${editor.name.toLowerCase()} costs ${priceWords('editor', 'month')} ${per('month')}.`,
    `Taalcut with a cloud AI comes to ${priceWords('cloud', 'month')} ${per('month')}, all of it your AI’s bill on your own plan or API keys: ${backWords('cloud', 'month', 'less')} (${changeWords('cloud')}), or ${usd(saving('cloud', 'year').usd)} ${per('year')}.`,
    `With every job on your computer’s own models, it comes to ${priceWords('local', 'month')}: ${backWords('local', 'month', 'less')} (${changeWords('local')}), or ${qualified(saving('local', 'year').approx, usd(saving('local', 'year').usd))} ${per('year')}.`,
  ].join(' ');
}

/** The comparison as list lines, for the home's and /ai/'s Markdown mirrors. */
export function costLines(): string[] {
  return COST_OPTIONS.map((o) => {
    const head = `${o.name}: ${priceWords(o.id, 'month')} ${per('month')} at ${VIDEOS_A_DAY} videos a day. ${o.line}`;
    return o.id === 'editor' ? head : `${head} ${capital(backWords(o.id, 'month'))} against hiring (${changeWords(o.id)}).`;
  });
}
