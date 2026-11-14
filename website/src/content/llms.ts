// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { PREMIUM_POINTERS } from './premium';
import { RELEASE } from './release';
import { SITE } from './site';

/**
 * The words llms.txt, llms-full.txt and the .md mirrors add around the pages (lane L4), and the few lines a mirror
 * needs where its page's words live in a component. Every fact is in the truth ledger: the release and what it runs
 * on (content/release.ts), the price, the licence and the public repository, and bring your own AI with the tested
 * sign-in only.
 */
export const LLMS = {
  facts:
    `Taalcut is free. ${RELEASE.name} runs on Macs with Apple silicon (${RELEASE.system}); there is no Ubuntu or Windows download yet, and Windows comes after 1.0. It works with the AI you already have: Continue with ChatGPT on the plan you pay for, your own API keys, or models that run on your computer. With its Local only switch on, nothing of yours leaves your computer; update checks still send the app’s version and a random ID. The app doesn’t run AI for you or keep your files. Its code is under the ${SITE.licence.name} licence at ${SITE.repository}. The download is at ${SITE.origin}/download/, and the newest release at ${RELEASE.latest}. ${PREMIUM_POINTERS.machine}`,
  fullIntro: 'Every page of taalcut.app as Markdown, in one file, in the order llms.txt lists them.',
  optional: 'Every page above in one file',
  /** The line that closes a mirror: the download, as a link (pages-md turns the two words into one). */
  get: `${RELEASE.name} is free, for Macs with Apple silicon. Download it, or read the code on GitHub.`,
} as const;

/** The home page's story, for its mirror (the page itself tells it with the hero stage). */
export const HOME_STORY = {
  problemsHeading: 'Two problems it solves',
  problems: [
    'The reel you saved and never made: paste it, and Taalcut makes your version from your own clips.',
    'A camera roll too big to sort by hand: Taalcut indexes it on your computer and picks the clip each moment needs.',
  ],
  stepsHeading: 'How it works',
  steps: [
    'Read: Taalcut breaks the reel into its cuts, music beats and on-screen text.',
    'Pick: it fills each slot from your camera roll, shows how sure it is, and keeps up to three other shots to swap in.',
    'Approve: you watch the cut once, swap anything you like, and export.',
  ],
  ai: 'Continue with ChatGPT on the plan you already pay for, use your own API keys, or run models on your computer.',
  private:
    'Your footage is indexed on your computer and stays there. With the Local only switch on, nothing of yours leaves your computer. Update checks still send the app’s version and a random ID.',
} as const;

/** Lines for the mirrors of pages whose words live in their components. */
export const MIRROR_LINES = {
  ai: 'Taalcut runs on the AI you already have: your ChatGPT plan, your own API keys, or models on your computer.',
  profiles: 'A profile sets the model for every job at once. Pick one in Settings › Models.',
  download: `${RELEASE.name} is a free download for Macs with Apple silicon on ${RELEASE.system}. Ubuntu and Windows have no download yet.`,
  contact: 'Write to the Taalcut team, or use the contact form. A reply comes by email.',
} as const;

/** When the site's words last changed: the sitemap's lastModified. Move it when content changes. */
export const CONTENT_UPDATED = '2026-11-14';
