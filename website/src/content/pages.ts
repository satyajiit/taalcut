// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { LIST_PRICE, PER_MONTH } from './premium';
import type { PageEntry } from './schema';

/**
 * Every page the site exports, once. The sitemap, llms.txt, the .md mirrors and each page's metadata read this list,
 * and a test fails when a route under src/app has no entry here (or an entry has no route).
 */
export const PAGES: readonly PageEntry[] = [
  {
    path: '/',
    title: 'Taalcut: make the reel you saved, from your own camera roll',
    description:
      'Paste a reel you love. Taalcut reads its beats and cuts, picks the right clips from your camera roll, and makes your version. You approve once.',
    section: 'Product',
  },
  {
    path: '/features/',
    title: 'Features',
    description: 'What Taalcut does: reads a reel, picks your clips, keeps templates, makes the video by chat, cuts shorts, makes launch videos, and more.',
    section: 'Features',
  },
  {
    path: '/features/reel-breakdown/',
    title: 'Read any reel',
    description: 'Taalcut writes down a reel’s cuts, music beats, on-screen text, transitions and pacing, so you can make it again.',
    section: 'Features',
  },
  {
    path: '/features/auto-pick/',
    title: 'Your camera roll, sorted',
    description: 'Taalcut indexes your clips on your computer and fills each slot with the clip that fits, with up to three other shots to swap in.',
    section: 'Features',
  },
  {
    path: '/features/templates/',
    title: 'Reels become templates',
    description: 'A reel’s breakdown becomes a template you can fill again with new footage, as often as you like.',
    section: 'Features',
  },
  {
    path: '/features/agent/',
    title: 'The editor you talk to',
    description: 'Taalcut’s agent makes the video, checks it against the reel, and asks you to approve once.',
    section: 'Features',
  },
  {
    path: '/features/editor/',
    title: 'Fine-tune when you want',
    description: 'A timeline for the moments you want to change something yourself: trims, captions, music beats, graphics and exports.',
    section: 'Features',
  },
  {
    path: '/features/import/',
    title: 'Bring your footage in',
    description: 'Footage from your phone over Wi-Fi, files and folders, and on a Mac a phone on a cable, a camera or card, and Apple Photos.',
    section: 'Features',
  },
  {
    path: '/features/shorts/',
    title: 'Shorts from long videos',
    description: 'Taalcut turns one long video into a portrait short with captions and your branding, cut on whole sentences and scenes.',
    section: 'Features',
  },
  {
    path: '/features/instagram-edits/',
    title: 'Sounds trending in Edits',
    description: 'With Instagram Edits on your Mac, Taalcut shows the sounds trending in Edits, marks each hook drop, and cuts your video to it.',
    section: 'Features',
  },
  {
    path: '/features/launch-videos/',
    title: 'Product launch videos',
    description: 'From a brief and your product’s website, documents or project folder, Taalcut writes the script and makes the launch video.',
    section: 'Features',
  },
  {
    path: '/features/product-videos/',
    title: 'A video per feature',
    description: 'Taalcut keeps finding video ideas for your product, one feature each, and prepares posts that wait for your approval.',
    section: 'Features',
  },
  {
    path: '/features/plugins/',
    title: 'Plugins and other agents',
    description: 'Postiz and Instagram Edits plugins, and other agents on your Mac, like Claude Code or Codex, working in Taalcut as you allow.',
    section: 'Features',
  },
  {
    path: '/ai/',
    title: 'Bring your own AI',
    description: 'Continue with ChatGPT on the plan you already pay for, use your own API keys, or run models on your computer.',
    section: 'Product',
  },
  {
    path: '/download/',
    title: 'Download',
    description: 'Download Taalcut, free, for Macs with Apple silicon: what it needs, how to install it, and where Ubuntu and Windows stand.',
    section: 'Product',
  },
  {
    path: '/premium/',
    title: 'Taalcut Premium',
    description: `The paid plan around the free app: we set Taalcut up on your Mac, pay for the top cloud models, and answer on WhatsApp. ${LIST_PRICE} ${PER_MONTH}.`,
    section: 'Product',
  },
  {
    // Where the payment page sends a buyer back: it checks one payment, so it is off the sitemap and llms.txt.
    path: '/premium/thanks/',
    title: 'Your Premium order',
    description: 'This page checks a Taalcut Premium payment with our billing service, right after you pay.',
    section: 'Product',
    unlisted: true,
  },
  {
    // The waitlist is closed. The address stays for the links that point at it, off the sitemap and llms.txt.
    path: '/waitlist/',
    title: 'Taalcut is out',
    description: 'The Taalcut waitlist is closed. Taalcut is out, as a free download for Macs with Apple silicon.',
    section: 'Product',
    unlisted: true,
  },
  {
    path: '/faq/',
    title: 'Questions',
    description: 'Straight answers about making videos with Taalcut, your footage and privacy, your AI, platforms and price.',
    section: 'Product',
  },
  {
    path: '/about/',
    title: 'About Taalcut',
    description: 'Why a reel editor is named after the rhythm cycle in Indian music, who Kaatu is, and how Taalcut is built.',
    section: 'Company',
  },
  {
    path: '/press/',
    title: 'Press kit',
    description: 'The Taalcut name, logo and mascot, with the rules for using them and the files to download.',
    section: 'Company',
  },
  {
    path: '/contact/',
    title: 'Contact',
    description: 'Write to the Taalcut team, or find us on Instagram at @taalcut.app.',
    section: 'Company',
  },
  {
    path: '/privacy/',
    title: 'Privacy',
    description: 'What this website collects, what the closed waitlist still holds, why, and how to have it deleted.',
    section: 'Legal',
  },
  {
    path: '/terms/',
    title: 'Terms',
    description: 'The terms for using taalcut.app, and what the closed waitlist still promises.',
    section: 'Legal',
  },
  {
    // The app's Beta update channel (Settings › General › Updates) links here before the switch. Not the product's
    // terms, which are /terms/: the only place on the site where "beta" is said, and it means the channel.
    path: '/beta-terms/',
    title: 'Beta channel terms',
    description: 'What choosing the Beta update channel in the Taalcut app means: the three lines the app shows before you switch.',
    section: 'Legal',
  },
];

/** The page entry for a path; throws on a typo, so a page can't ship without its words. */
export function page(path: string): PageEntry {
  const entry = PAGES.find((p) => p.path === path);
  if (!entry) throw new Error(`No PAGES entry for ${path}`);
  return entry;
}
