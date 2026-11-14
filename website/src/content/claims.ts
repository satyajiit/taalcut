// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { COST_CHANGES, MINUS } from './cost';

/**
 * WEB2's hedge sweep: words that tell a visitor the thing in front of them isn't real. The demos run on the owner's
 * own reel and footage; the legal pages carry their date. claims-hedges.test.ts also runs them over every prose
 * string literal in src/.
 */
export const HEDGES: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bdrafts?\b/i, why: 'Say what it is: "the cut", "the video", "first passes"; the legal pages carry their date' },
  { pattern: /\bsamples?\b/i, why: 'The demos are the owner’s real reel and footage: name them, never "sample"' },
  { pattern: /\bestimat(e|es|ed|ing)\b/i, why: 'Say what Taalcut found, or leave the number out' },
  { pattern: /\bmade up for (this|the) demo\b/i, why: 'Say what the demo shows' },
  { pattern: /\bstands? in\b|\bstood in\b|\bstand-ins?\b/i, why: 'Say what the thing is' },
  { pattern: /\bplaceholders?\b/i, why: 'Nothing on the site is a placeholder' },
];

/**
 * The stack sweep (the owner, 2026-11-06): what the site is built and hosted on stays out of what a visitor or an engine
 * reads. Say "our cloud provider", "the bot check" or "your browser's storage" instead. Code identifiers, comments,
 * firebase/ and its DATA.md are internal and keep their names. claims-stack.test.ts runs these over every prose string
 * literal in src/ and over the machine-read files (llms.txt, llms-full.txt, the .md mirrors, JSON-LD).
 */
export const STACK_NAMES: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bfire(store|base)\b/i, why: 'Say "our cloud provider", never the database or hosting product' },
  { pattern: /\bgoogle cloud\b/i, why: 'Say "our cloud provider"' },
  { pattern: /\bapp ?check\b/i, why: 'Say "the bot check"' },
  { pattern: /\brecaptcha\b/i, why: 'Say "the bot check"' },
  { pattern: /\bnext\.?js\b/i, why: 'The site’s framework is not the visitor’s business' },
  { pattern: /\bvercel\b/i, why: 'Say "our cloud provider"' },
  { pattern: /\bcloudflare\b/i, why: 'Say "our cloud provider"' },
  { pattern: /\bgoogle analytics\b|\bGA4\b|\bgtag\b/i, why: 'Say "an analytics service run by our cloud provider"' },
];

/**
 * Taalcut Premium's ledger (the owner, 2026-11-14). Premium is a plan a creator buys, sold as what it is: never a stage
 * of something, never a promise of a result, and never dressed up with people who don't exist. What may be said: the
 * list price a month (content/premium.ts › PREMIUM.listAmount; a launch price only as the billing service quotes it),
 * what is in the plan (PREMIUM_PAGE.included), that a plan is active within 7 days of payment and the paid month starts
 * that day, the refund when it isn't, one payment link a month with no stored card, support hours in India time, fair
 * use, that it needs an Apple silicon Mac, and that Premium sends a make's material to cloud models. premium.test.ts
 * runs these over every Premium string, the terms, the privacy notice and the mirrors; claims.test.ts over the site.
 */
export const PREMIUM_RULES: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  {
    pattern: /\btrials?\b|\bpilots?\b|\bearly[- ]birds?\b|\bexperiment(s|al)?\b/i,
    why: 'Premium is a plan: never a trial, a pilot, an early-bird deal or an experiment',
  },
  { pattern: /\bguarantee[sd]?\b/i, why: 'Advice is advice and a make can fail: say what we do, never what is guaranteed' },
  {
    pattern: /\b(grow|boost|double|triple|multiply|increase)s? your (reach|views|followers|audience|income|channel|sales)\b|\bgo(es|ing)? viral\b/i,
    why: 'No promise of reach, views or income',
  },
  { pattern: /\bunlimited\b|\bno limits?\b/i, why: 'The models we pay for are under fair use: never "unlimited"' },
  {
    pattern:
      /\b(always|never fails? to) (finish(es)?|complete[sd]?|succeed(s)?|works?|deliver(s)?)\b|\b(finish(es)?|complete[sd]?|succeed(s)?|works?) every time\b|\bnever fails?\b/i,
    why: 'Nobody measured that the top models always finish a make: say they are the top models, not what they always do',
  },
  {
    pattern:
      /\b(already|now) (use[sd]?|using|on|with) premium\b|\bpremium (members|customers|creators|buyers) (love|say|report|tell|are|have|get|got|made|make)\b|\b(joined by|join) (\d[\d,]*|dozens|hundreds|thousands)\b|\bour (members|customers)\b/i,
    why: 'Nothing says or implies that anyone already uses Premium: write to "you", in the present',
  },
  { pattern: /\b(razorpay|stripe|paypal)\b/i, why: 'Say "our payment provider"' },
];

/**
 * The truth ledger's "don't say" column as patterns (WEB1 plan). test/unit/claims.test.ts runs every string in
 * src/content and every text node in src/app and src/components against them. A match fails the build: change the
 * words, or change the ledger with the owner first.
 */
export const BANNED_CLAIMS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\b(works|runs|available) on windows\b/i, why: 'Windows is not supported yet: say "coming soon"' },
  { pattern: /\bwindows (is )?supported\b/i, why: 'Windows is not supported yet' },
  {
    // The one encryption the site may name is the app's: keys and sign-ins kept encrypted with a key in the keychain.
    pattern: /\bencrypt(ed|ion)?\b(?!\s+with a key in your (computer|Mac)['’]s keychain)/i,
    why: 'The phone transfer is plain HTTP on the local network; only keys are "kept encrypted with a key in your computer’s keychain"',
  },
  {
    // The one exception: the cost comparison's changes, computed in cost.ts from the owner's prices and written by its
    // change() (a minus sign, U+2212, then the number). Any other percentage, or one of those typed another way, fails.
    pattern: new RegExp(String.raw`(?<!${MINUS})\b\d+(\.\d+)?\s?%|${MINUS}(?!(?:${COST_CHANGES.join('|')})%)\d+(\.\d+)?\s?%`),
    why: 'No measured percentage exists that the site may quote; the cost comparison prints only the changes cost.ts computes',
  },
  { pattern: /\b\d+(\.\d+)?\s?x (faster|quicker|better)\b/i, why: 'No speed claim has been measured' },
  { pattern: /\btrusted by\b|\bloved by\b|\bthousands of creators\b/i, why: 'There are no users, testimonials or counts yet' },
  {
    // The release is a .dmg for Apple silicon Macs (content/release.ts): "Download for Mac" is the one download the site names.
    pattern: /\b(download now|download for (ubuntu|linux|windows))\b/i,
    why: 'Only the Mac has a download: say "Download for Mac", and say Ubuntu and Windows have none yet',
  },
  { pattern: /\bhub is (live|open)\b|\bbrowse the hub\b/i, why: 'The template hub is built but not deployed' },
  { pattern: /\b(claude pro|claude max|copilot|supergrok)\b/i, why: 'Those subscription sign-ins are untested and stay off the site' },
  { pattern: /\bc2pa\b|\bcontent credentials\b/i, why: 'C2PA uses a test certificate' },
  { pattern: /\b(is|are|it's|it’s) open[- ]source\b/i, why: 'Name the licence and where the code is: say LICENCE_LINE (content/site.ts)' },
  { pattern: /\bis free software\b/i, why: 'Say "Taalcut is free. Its code is on GitHub under the AGPL-3.0-or-later licence."' },
  // The waitlist closed with the first release: nothing invites a sign-up, and nothing says the app or its code is still to come.
  { pattern: /\bjoin (the|our) waitlist\b|\bjoin for (macos|ubuntu|windows)\b/i, why: 'The waitlist is closed: say "Download for Mac"' },
  { pattern: /\bprivate build\b/i, why: 'Taalcut is released and its code is on GitHub' },
  {
    // The owner, 2026-11-14: what you download is a release, never "the beta". The word stays only for the app's Beta update
    // channel (content/legal.ts › BETA_TERMS, /beta-terms/); release.test.ts pins where it may appear.
    pattern:
      /\b(public|private|free|first|open|closed|mac|macos|taalcut|this|our) beta\b|\bbeta (is (out|open|here)|opens|first opens|release|download|testers?|version|build|software)\b|\b(in|into|out of) beta\b|\bthe beta (is|runs|opens|has|comes)\b|\bpre-?release\b/i,
    why: 'What you download is a release, not a stage: say "Taalcut" or its name with its number (RELEASE.name), with no hype in its place. "Beta" means the app’s update channel only',
  },
  // Fix round 1's truth review (website fix-1 ledger): claims the app doesn't back.
  {
    pattern:
      /\bone[- ]line reasons?\b|\b(says|tells you|explains) why\b|\breasons? (for|behind) (each|every|its|the) (pick|clip|choice|slot)s?\b|\b(picks?|clips?|slots?) (and|with) (a|its|their) reasons?\b|\b(each|every)\b[^.]{0,40}\b(a|its|their) reasons?\b/i,
    why: 'The app shows what a slot wants, how sure the AI is and other shots, never a reason per pick',
  },
  { pattern: /\bper[- ]chat\b/i, why: 'How hard the agent thinks is one setting in the chat box, not per chat' },
  { pattern: /\b(web)?vtt\b/i, why: 'Captions export as an SRT file, never VTT' },
  {
    pattern: /\bsends? nothing out\b|\bnothing leaves\b/i,
    why: 'Say "Nothing of yours leaves your computer. Update checks still send the app’s version and a random ID."',
  },
  {
    pattern:
      /\b(finds?|found|reads?|detects?|catch(es)?|marks?|spots?|writes? down|maps?) every (cut|(music )?beat)s?\b|\bevery cut and (every )?(music )?beat\b/i,
    why: 'It finds the cuts and music beats: never "every cut" or "every beat"',
  },
  {
    pattern: /\b(llama\.cpp|vllm)\b[^.]{0,60}\b(servers?|advanced|accounts)\b|\b(servers?|advanced|accounts)\b[^.]{0,60}\b(llama\.cpp|vllm)\b/i,
    why: 'Your own server is Ollama or LM Studio only, in Settings › Accounts › Servers',
  },
  {
    // A lone capitalised badge, or a desktop OS called supported. The lowercase `supported` status id is data.
    pattern: /^\s*(Officially |Fully )?Supported\s*$|\b(macOS|Ubuntu|Linux|Mac)\b[^.]{0,12}\b(is |are )?([Oo]fficially |[Ff]ully )?[Ss]upported\b/,
    why: 'Say what each platform has today (a download, or none yet), not "Supported"',
  },
  // DESIGN.md › Words and SOUL.md: the product's own vocabulary.
  { pattern: /\brender(s|ed|ing)?\b/i, why: 'A video is exported, never rendered, on screen' },
  { pattern: /\bassets?\b/i, why: 'Say "clip", not "asset"' },
  { pattern: /\bBPM\b/, why: 'Say "music beats", not BPM' },
  {
    pattern: /\b(seamless(ly)?|elevate|delve|tapestry|testament|vibrant|unleash|supercharge|revolutioni[sz]e|game[- ]changer|cutting[- ]edge|effortless(ly)?)\b/i,
    why: 'Stock AI words (SOUL.md)',
  },
  // WEB2: the site shows the product as it is. No hedge tells a visitor that what they see is a stand-in.
  ...HEDGES,
  // WEB2: no stack names in visitor text.
  ...STACK_NAMES,
  // Premium: a plan, sold as what it is.
  ...PREMIUM_RULES,
];

export interface ClaimViolation {
  readonly text: string;
  readonly why: string;
}

/** Every banned pattern a piece of copy matches. */
export function claimViolations(text: string): ClaimViolation[] {
  return BANNED_CLAIMS.filter(({ pattern }) => pattern.test(text)).map(({ why }) => ({ text, why }));
}
