// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Feature } from './schema';

/**
 * WEB3: the features beyond making a video like a reel (the owner, 2026-11-06: "import options, shorts from videos, ig
 * edits integrations for trendings/scores etc, other plugins, create product launch trailers, automatically create
 * videos for features of products"). Every fact was checked against the app's own code and words at d9ab77925
 * (Library › Import, Make a short, the Instagram Edits and Postiz plugins, Settings › External agents, Create › Product
 * launch, Products). What stays off the site is in the truth ledger (SPEC.md › Truth ledger, WEB3 rows).
 */
export const MORE_FEATURES: readonly Feature[] = [
  {
    slug: 'import',
    group: 'more',
    name: 'Bring your footage in',
    definition:
      'Taalcut brings footage in from your phone over Wi-Fi, from files and folders on your computer, and on a Mac from a phone on a cable, a camera or card, and Apple Photos, then checks every copy and indexes it on your computer.',
    summary:
      'Scan a code to send clips from your phone, or bring in files and folders. On a Mac, a phone on a cable, a camera or card, and Apple Photos work too.',
    facts: [
      ['From your phone', 'Over Wi-Fi: scan a code and choose footage in the phone’s browser, with nothing to install. On a Mac, on a cable too, iPhone or Android'],
      ['From your computer', 'Files, or a folder copied in or read where it is, and watched for new footage'],
      ['From a camera', 'A mounted camera, drive or card, and DJI and Insta360 originals, on a Mac'],
      ['From Apple Photos', 'Originals from your System Photo Library on a Mac, with iCloud originals downloaded if you ask. Photos edits aren’t included'],
    ],
    status: 'shipped',
  },
  {
    slug: 'shorts',
    group: 'more',
    name: 'Shorts from long videos',
    definition:
      'Taalcut turns one long video into a portrait short with captions and your branding: it picks whole sentences and scenes for a hook, the context and the payoff, and checks the cut against the original before you see it.',
    summary:
      'Choose a long video and a length. You get a short that starts strong and ends where the story does, with captions on.',
    facts: [
      ['From', 'A video in your library, a file, or a YouTube link'],
      ['Length', '30, 60 or 90 seconds, or any length from 15 to 179. The cut may run shorter to keep the story whole'],
      ['It picks', 'Whole sentences and scenes: a hook, the context and the payoff'],
      ['Before you see it', 'A second check compares the cut with the original frames and fixes it, up to twice. If it still isn’t right, the short waits for your review'],
    ],
    status: 'shipped',
  },
  {
    slug: 'instagram-edits',
    group: 'more',
    name: 'Sounds trending in Edits',
    definition:
      'With the Instagram Edits app open on your Mac, Taalcut shows the sounds trending in Edits, marks where each one’s hook drops, and cuts your next video to it.',
    summary:
      'Connect Edits once. Browse its trending sounds, see where each hook drops, and start a video on the beat of one.',
    facts: [
      ['Sounds', 'Trending, For You, Original audio, Royalty-free and Saved, with a licence filter'],
      ['Hooks', 'Where each sound’s hook drops, in seconds, so the cuts land on it'],
      ['Scores', 'With Edits connected, the AI can use its on-device tools: a vibe score for a clip, a subject cut out, a voice cleaned up'],
      ['Hand-off', 'A finished video staged in Edits with its captions still editable and the sound attached, to post from Edits'],
    ],
    status: 'shipped',
  },
  {
    slug: 'launch-videos',
    group: 'more',
    name: 'Product launch videos',
    definition:
      'Give Taalcut a brief and the website, documents or project folder behind your product, and it researches them, writes the script, designs the scenes and makes the launch video once you approve the script.',
    summary:
      'Say what you want to show, add your product’s sources, approve the script and the look, and the video opens in the editor.',
    facts: [
      ['Sources', 'A website or document link, a project folder, clips from your library, and a recording of your voice'],
      ['It captures', 'Screenshots of your sources and, if you allow it, a JavaScript project’s app running in an isolated copy'],
      ['You approve', 'A script of up to 12 scenes and its look, before anything is made'],
      ['Formats', 'Landscape, portrait, square or 4:5, with a generated voiceover, your own recording, or none'],
    ],
    status: 'shipped',
  },
  {
    slug: 'product-videos',
    group: 'more',
    name: 'A video per feature',
    definition:
      'Save your product and its sources once, and Taalcut keeps finding video ideas, each about one feature and backed by lines from your sources, and can make the strongest one into a video for you.',
    summary:
      'Taalcut researches your product when you choose, proposes a video per feature, and prepares posts that wait for your approval.',
    facts: [
      ['Ideas', 'One feature each, with the lines from your sources behind it, and no topic again until the days you set have passed'],
      ['On a schedule', 'Research runs in the background at the times you choose, in the installed app'],
      ['Ready-made', 'If you want, the strongest idea made into a video, with a limit a day and a budget per video'],
      ['Posting', 'Through your Postiz account, each post only after you approve it, from a 4K master'],
    ],
    status: 'shipped',
  },
  {
    slug: 'plugins',
    group: 'more',
    name: 'Plugins and other agents',
    definition:
      'Plugins connect Taalcut to the tools you already use, Postiz for posting and Instagram Edits for sounds, and other agents on your Mac, like Claude Code or Codex, can work in Taalcut with the permissions you give them.',
    summary:
      'Turn a plugin on, choose what the AI may do with it, and see every tool it adds. Let another agent on your Mac edit with Taalcut, and take that back any time.',
    facts: [
      ['Postiz', 'Schedule and post to your channels once you approve, and read how each post did'],
      ['Instagram Edits', 'Trending sounds and hook drops, and finished videos staged in Edits'],
      ['Your say', 'Each plugin’s connection, what the AI may do with it, and the tools it adds, in Settings › Plugins'],
      ['Other agents', 'Claude Code or Codex on your Mac can read, edit or export in Taalcut, as you allow. Exports and deletes still ask you'],
    ],
    status: 'shipped',
  },
];

export interface MoreStep {
  readonly title: string;
  readonly body: string;
}

/** How each works, in three short steps (the feature page's "How it works"), in the app's own words. */
export const MORE_STEPS: Readonly<Record<string, readonly MoreStep[]>> = {
  import: [
    {
      title: 'Choose a way in',
      body: 'Library › Import lists them all: Files, Folder, Phone over Wi-Fi, Phone on a cable, Camera or card, DJI, Insta360 and Apple Photos. On Ubuntu: files, folders and your phone over Wi-Fi.',
    },
    {
      title: 'Send from your phone',
      body: 'Scan the code with the phone’s camera and choose footage in its browser, on the same Wi-Fi. On an iPhone, Choose from Files keeps the original quality.',
    },
    {
      title: 'Every copy is checked',
      body: 'Taalcut checks each copy, then indexes it on your computer. A clip is ready to edit before it is fully analysed, and searchable soon after.',
    },
  ],
  shorts: [
    {
      title: 'Choose a long video',
      body: 'On a clip’s page, on a video in your library, or in a new chat, choose Make a short. A YouTube link works too, unless Local only is on.',
    },
    {
      title: 'Choose the length',
      body: '30, 60 or 90 seconds, or your own from 15 to 179. The AI reads what is said and shown, and picks whole sentences and scenes that tell the story.',
    },
    {
      title: 'Finish it in the editor',
      body: 'The short opens on the timeline with captions, your branding and words for the post. Export with Smart reframe and the frame follows the person in each shot.',
    },
  ],
  'instagram-edits': [
    {
      title: 'Connect Edits',
      body: 'With Edits open on your Mac, copy its automation token from its Settings, then choose Import from clipboard in Taalcut’s Settings › Plugins. Your Instagram sign-in stays in Edits.',
    },
    {
      title: 'Find the sound',
      body: 'Trending sounds & hooks sits on Make and Create. Search, filter by licence, see where the hook drops, and save a sound for later.',
    },
    {
      title: 'Cut to it',
      body: 'Choose Cut with AI to start your next video on that sound, its cuts on the beat. When it’s done, stage it in Edits and post from there.',
    },
  ],
  'launch-videos': [
    {
      title: 'Write the brief',
      body: 'In Create, choose Product launch and describe the idea, the product and the feeling. Add the website, folders and clips that explain it: Taalcut reads only the sources you choose.',
    },
    {
      title: 'Approve the script and the look',
      body: 'Taalcut researches your sources and proposes the script and the visual direction. Edit the words and timing; each change is a new version for you to approve.',
    },
    {
      title: 'The video opens in the editor',
      body: 'Taalcut designs each scene and adds the voiceover, then opens the video on the timeline with its graphics still editable.',
    },
  ],
  'product-videos': [
    {
      title: 'Add your product',
      body: 'In Products, describe it, the features to show and the videos you want, and attach its website, project folders and social pages.',
    },
    {
      title: 'Get ideas, or let it work',
      body: 'Find video ideas suggests stories grounded in your sources, preferences and earlier videos. Or let Taalcut research on a schedule and make the strongest idea into a video.',
    },
    {
      title: 'Approve, then post',
      body: 'Check each platform’s version, words, account and time. Posts go out through your Postiz account only after you approve them.',
    },
  ],
  plugins: [
    {
      title: 'Turn one on',
      body: 'Settings › Plugins lists them. Each has its own Connection: Postiz, hosted or on your own server, and Instagram Edits on your Mac.',
    },
    {
      title: 'Choose what it may do',
      body: 'Access says what the AI may do with a plugin; Tools and Skills list what it adds. Nothing is posted until you approve it.',
    },
    {
      title: 'Let another agent in',
      body: 'In Settings › External agents, let agents on this Mac use Taalcut and choose Connect an agent to copy the setup for Claude Code or Codex. Revoke it whenever you like.',
    },
  ],
};

/** Each one's key facts as the header's stickers, a few words each. */
export const MORE_STICKERS: Readonly<Record<string, readonly string[]>> = {
  import: ['Phone over Wi-Fi', 'Watched folders', 'Cameras, DJI and Insta360'],
  shorts: ['One long video in', 'Cut on whole sentences', 'Captions and your branding'],
  'instagram-edits': ['Trending in Edits', 'Hook drops marked', 'Cut on the beat'],
  'launch-videos': ['From a brief and your sources', 'You approve the script', 'Landscape to 4:5'],
  'product-videos': ['A video per feature', 'Research on a schedule', 'Posts wait for you'],
  plugins: ['Postiz and Instagram Edits', 'You choose what it may do', 'Claude Code and Codex'],
};
