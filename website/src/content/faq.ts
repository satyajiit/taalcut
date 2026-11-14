// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { costInWords } from './cost';
import { BOTH_PRICES, FAQ_PREMIUM, FAQ_STILL_FREE, PREMIUM } from './premium';
import { KNOWN_LIMIT, RELEASE } from './release';
import type { FaqEntry } from './schema';
import { LICENCE_LINE, SITE, TRADEMARK_POLICY } from './site';

/**
 * The FAQ page, FAQPage JSON-LD and llms-full.txt print these as written. Every answer is in the truth ledger. The
 * ids are anchors (`/faq/#footage-leaves`), linked from other pages and the app, so they never change.
 */
export const FAQ: readonly FaqEntry[] = [
  {
    id: 'what-is-taalcut',
    group: 'Making videos',
    question: 'What is Taalcut?',
    answer:
      'Taalcut is an AI video editor for short videos. You paste a reel you like and point it at your footage. It breaks the reel into its beats and cuts, picks the clips from your camera roll that fit each part, and makes your version. You approve it once and export. It also cuts shorts from long videos, finds sounds trending in Instagram Edits, and makes launch videos for products.',
  },
  {
    id: 'which-reels',
    group: 'Making videos',
    question: 'Which reels can it read?',
    answer:
      'Instagram Reels, YouTube Shorts and TikTok links, or a video file you drop in, including a screen recording. On Ubuntu, pasting a reel link isn’t there yet: drop the reel in as a file. Taalcut finds the cuts and music beats, the on-screen text and when it shows, transitions, speed ramps and the pacing. Before it’s used, you can fix a cut, the tempo, or whether something is text.',
  },
  {
    id: 'how-picks',
    group: 'Making videos',
    question: 'How does it choose my clips?',
    answer:
      'Each part of the reel says what it needs, such as a wide shot that opens the place or a close-up on the beat drop. Taalcut searches your indexed footage for the clip that fits, shows how sure it is (High, Medium or Low), and offers up to three other shots for each part if you want to swap. The story keeps its order. Taalcut can make up to 10 versions.',
  },
  {
    id: 'do-i-edit',
    group: 'Making videos',
    question: 'Do I have to edit anything?',
    answer:
      'No. The agent makes the video and checks it against the reel before you see it. You approve once. If you want to change something, the timeline is there, and undo covers every edit, the agent’s included.',
  },
  {
    id: 'reuse-template',
    group: 'Making videos',
    question: 'Can I use a reel’s template again?',
    answer:
      'Yes. Every reel Taalcut reads becomes a template you keep, with its slots, music beats and text timing. Fill it with new footage as often as you like. Taalcut also comes with 8 starter templates in your language, 14 in all.',
  },
  {
    id: 'export',
    group: 'Making videos',
    question: 'What can I export?',
    answer:
      'MP4 in H.264 or HEVC, sized for Reels, Shorts and TikTok, with captions as an SRT file if you want them. You can also hand the timeline to another editor as OTIO or FCPXML.',
  },
  {
    id: 'shorts',
    group: 'Making videos',
    question: 'Can it make shorts from a long video?',
    answer:
      'Yes. Choose a long video from your library, a file or a YouTube link (unless Local only is on), and a length: 30, 60 or 90 seconds, or your own from 15 to 179. Taalcut picks whole sentences and scenes for a hook, the context and the payoff, checks the cut against the original, and makes one portrait short with captions and your branding.',
  },
  {
    id: 'instagram-edits',
    group: 'Making videos',
    question: 'Does Taalcut work with Instagram Edits?',
    answer:
      'Yes, on a Mac with the Edits app open. Taalcut shows the sounds trending in Edits and where each hook drops, cuts your video to one, and stages the finished video in Edits with its captions still editable, for you to post from there. Your Instagram sign-in stays in Edits.',
  },
  {
    id: 'launch-video',
    group: 'Making videos',
    question: 'Can it make a launch video for my product?',
    answer:
      'Yes. In Create, choose Product launch, write a brief and add your product’s website, documents or project folders, and Taalcut researches them and proposes a script of up to 12 scenes and a look for you to approve before anything is made. Making it uses the AI accounts you connect, and the video opens in the editor in landscape, portrait, square or 4:5, its graphics still editable.',
  },
  {
    id: 'product-videos',
    group: 'Making videos',
    question: 'Can it make videos about my product’s features?',
    answer:
      'Yes. Save your product and its sources once in Products, and Taalcut finds video ideas, each about one feature and backed by lines from your sources, on a schedule if you like. It can make the strongest idea into a video, and posts go out through your Postiz account only after you approve them.',
  },
  {
    id: 'posting',
    group: 'Making videos',
    question: 'Can Taalcut post my videos?',
    answer:
      'Only after you approve each post. With the Postiz plugin, Taalcut schedules and posts to your channels through your Postiz account; with Instagram Edits, it stages the video in Edits and you post from there.',
  },
  {
    id: 'footage-leaves',
    group: 'Your footage and privacy',
    question: 'Does my footage leave my computer?',
    answer:
      'Indexing, search, text in video and music beats run on your computer, and your footage stays there. If you connect a cloud model, Taalcut asks before it first sends your files to it, and Settings › Privacy lists what leaves your computer. With Local only on, nothing of yours leaves your computer. Update checks still send the app’s version and a random ID.',
  },
  {
    id: 'local-only',
    group: 'Your footage and privacy',
    question: 'Can I keep everything on my computer?',
    answer:
      'Yes. Turn on Local only in Settings › Privacy. Nothing of yours leaves your computer: no cloud models, uploads, reel links, feedback or usage counts. Update checks still send the app’s version and a random ID. Jobs that have no model on your computer stay off until you turn it off again.',
  },
  {
    id: 'phone-import',
    group: 'Your footage and privacy',
    question: 'How do I get clips off my phone?',
    answer:
      'Scan a QR code with your phone and enter the PIN Taalcut shows. Clips upload over your Wi-Fi, with nothing to install on the phone, and a dropped upload picks up where it stopped. You can also point Taalcut at folders, which it reads in place.',
  },
  {
    id: 'iphone',
    group: 'Your footage and privacy',
    question: 'Can Taalcut bring footage from my iPhone?',
    answer:
      'Yes. Scan the code Taalcut shows with your iPhone’s camera and choose footage in its browser, over the same Wi-Fi and with nothing to install; Choose from Files keeps the original quality. On a Mac, an iPhone on a cable and your Apple Photos originals work too, and Taalcut checks every copy before it indexes it.',
  },
  {
    id: 'chatgpt',
    group: 'Your AI',
    question: 'Can I use my ChatGPT subscription?',
    answer:
      'Yes. Continue with ChatGPT signs in with OpenAI and uses the plan you already pay for. Taalcut never sees your password. You can also use API keys for OpenAI, Anthropic, Google, OpenRouter and ElevenLabs, or run models on your computer.',
  },
  {
    id: 'need-ai',
    group: 'Your AI',
    question: 'Do I need an AI subscription?',
    answer:
      'No. Taalcut downloads and runs its own models on your computer. A ChatGPT plan or an API key adds stronger cloud models. On a Mac with 8 GB of memory, understanding images needs one.',
  },
  {
    id: 'own-server',
    group: 'Your AI',
    question: 'Can I use Ollama or LM Studio?',
    answer:
      'Yes. If you already run Ollama or LM Studio, add it in Settings › Accounts › Servers. You never need one, because Taalcut already runs models on your computer.',
  },
  {
    id: 'other-agents',
    group: 'Your AI',
    question: 'Can other AI agents use Taalcut?',
    answer:
      'Yes, on a Mac. Turn on Settings › External agents, and Claude Code or Codex can read, edit or export in Taalcut as you allow; exports and deletes still ask you, and you can revoke access any time. It is off until you turn it on.',
  },
  {
    id: 'cost',
    group: 'Platforms and price',
    question: 'What does it cost?',
    // The comparison is computed in cost.ts from the owner's three prices, never typed here.
    answer: `Taalcut is free. The app doesn’t run AI for you or keep your files, so using it costs you nothing from Taalcut. If you use a cloud model, you use your own plan or API key with that provider. ${costInWords()} ${PREMIUM.name} is a paid plan around the app, where we set it up and pay for the top models, at ${BOTH_PRICES}.`,
  },
  { ...FAQ_STILL_FREE, group: 'Platforms and price' },
  { ...FAQ_PREMIUM, group: 'Platforms and price' },
  {
    id: 'platforms',
    group: 'Platforms and price',
    question: 'Which computers does it run on?',
    answer:
      'Taalcut runs on Macs with Apple silicon (M1 or later) on macOS 14 or later; 8 GB of memory and 20 GB of free space are recommended. There is no Ubuntu or Windows download yet. Built from source, Taalcut runs on Ubuntu 24.04 on x64, where the agent on your computer needs a graphics card with 8 GB of video memory. Windows comes after 1.0.',
  },
  {
    id: 'open-code',
    group: 'Platforms and price',
    question: 'Can I read the code?',
    answer:
      `Yes. ${LICENCE_LINE} The repository is at ${SITE.repository}. The name and logo follow ${TRADEMARK_POLICY}.`,
  },
  {
    id: 'when',
    group: 'Platforms and price',
    question: 'When can I use it?',
    answer:
      `Now, on a Mac with Apple silicon. ${RELEASE.name} is a free download at ${SITE.origin}/download/. ${KNOWN_LIMIT}`,
  },
];

/** The FAQ's groups, in the order the page shows them. */
export const FAQ_GROUPS: readonly FaqEntry['group'][] = ['Making videos', 'Your footage and privacy', 'Your AI', 'Platforms and price'];

/** A group's anchor on /faq/ (`#group-your-ai`). */
export function faqGroupId(group: FaqEntry['group']): string {
  return `group-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}
