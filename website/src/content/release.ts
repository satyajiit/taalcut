// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Fact } from './schema';
import { SITE } from './site';

/**
 * The release the site offers. A new release changes VERSION and nothing else: the tag, the versioned file's name and
 * every address derive from it, and the buttons, /download/, the .md mirrors, llms.txt and the JSON-LD read them from
 * here. The site calls it by its name and number (RELEASE.name), never by a stage.
 *
 * Download for Mac does not carry the version: the release publisher keeps a copy of the newest stable .dmg under one
 * fixed name, so the button is right even before VERSION is changed here.
 */
const VERSION = '0.1.0';
const TAG = `v${VERSION}`;
const FILE = `Taalcut-${VERSION}-arm64.dmg`;
const NEWEST_FILE = 'Taalcut-mac-arm64.dmg';

export const RELEASE = {
  version: VERSION,
  tag: TAG,
  /** The product with its number: how the site names the release. */
  name: `${SITE.name} ${VERSION}`,
  /** What Download for Mac fetches: the newest stable .dmg, under the name it always has. */
  download: `${SITE.repository}/releases/download/channel-stable/${NEWEST_FILE}`,
  downloadFile: NEWEST_FILE,
  /** The same .dmg under its versioned name, on its own release, where the page names the exact file. */
  file: FILE,
  fileUrl: `${SITE.repository}/releases/download/${TAG}/${FILE}`,
  /** The release's own page: its notes, the SHA-256 sums and FFmpeg's source. */
  page: `${SITE.repository}/releases/tag/${TAG}`,
  /** GitHub's newest release, whichever it is by then. */
  latest: `${SITE.repository}/releases/latest`,
  releases: `${SITE.repository}/releases`,
  issues: `${SITE.repository}/issues`,
  discussions: `${SITE.repository}/discussions`,
  /** What it runs on, as schema.org and the short notes say it. */
  system: 'macOS 14 or later',
  chip: 'Apple silicon',
} as const;

/**
 * What a make does on the default on-device model, said wherever a download button is (the release's own record: on
 * a 24 GB Mac the makes did not run from start to finish unattended). Never a number the record doesn't have.
 */
export const KNOWN_LIMIT =
  'On a Mac with 24 GB of memory, the default on-device model often doesn’t finish a make by itself. The chat says where it stopped and keeps what it assembled, and you finish the video in the editor.';

/** The two things a visitor can do, named one way on every page. */
export const GET = {
  download: 'Download for Mac',
  github: 'GitHub',
  /** The GitHub link's name where only its icon shows (the header). */
  githubName: 'Taalcut on GitHub',
  /** Under the buttons: the release and what it needs. */
  note: `${RELEASE.name} · Free · ${RELEASE.chip}, ${RELEASE.system}`,
  /** The hero's way to the rest: requirements, the steps and KNOWN_LIMIT, on /download/. */
  more: 'What it needs and what to expect',
} as const;

/** The band that closes a page: the line, the lead and its stickers. The buttons and KNOWN_LIMIT sit beside them. */
export const DOWNLOAD_BAND = {
  heading: 'Make your first one on your Mac.',
  lead: `${RELEASE.name} is out for Macs with Apple silicon, and it is free.`,
  stickers: { free: 'Free', mac: 'Apple silicon Macs' },
} as const;

/** /download/ under its platforms: the three steps, then the facts beside a download. */
export const INSTALL = {
  heading: 'Install it in three steps',
  steps: [
    {
      title: 'Download the .dmg',
      body: `Download for Mac fetches ${RELEASE.downloadFile} from GitHub: the newest release, which is ${RELEASE.name}.`,
    },
    { title: 'Drag it into Applications', body: 'Open the .dmg and drag Taalcut into Applications.' },
    {
      title: 'Open Taalcut',
      body: 'It checks your Mac, picks models that fit it and downloads them in the background while you add a folder or connect a phone.',
    },
  ],
  factsHeading: 'Before you make your first video',
  /** Each a label and a sentence; links as `[label](href)` (InlineText and the mirrors read them). */
  facts: [
    [
      'Signed and notarized',
      'Taalcut is signed with a Developer ID and notarized by Apple, so it opens the ordinary way.',
    ],
    ['What to expect', KNOWN_LIMIT],
    [
      'Language',
      'The app is in English. Its Hindi, Spanish and Brazilian Portuguese translations are first passes that haven’t been reviewed.',
    ],
    [
      'Notes and checksums',
      `The [${RELEASE.version} release](${RELEASE.page}) has the release notes, the SHA-256 sums for its files and FFmpeg’s source. The download is there under its versioned name, [${RELEASE.file}](${RELEASE.fileUrl}). [Every release](${RELEASE.releases}) is on GitHub.`,
    ],
    [
      'Build it from source',
      `The code is on [GitHub](${SITE.repository}) under the ${SITE.licence.name} licence. Its README says how to build Taalcut yourself.`,
    ],
    [
      'Something wrong?',
      `Report it in the repository’s [issues](${RELEASE.issues}), or ask in its [discussions](${RELEASE.discussions}).`,
    ],
  ] satisfies readonly Fact[],
} as const;
