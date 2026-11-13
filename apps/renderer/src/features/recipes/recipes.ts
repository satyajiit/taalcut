// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Recipes (P3-V11): tappable starter prompts by task. Each puts its prompt in the composer, unsent; the person
 * sends or edits it. `expects` names the commands a finished run of it must have dispatched (the desktop
 * recipes.e2e.ts checks them in the audit log), always through core's command-name constants.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import {
  CAPTION_COMMANDS,
  GRAPHICS_COMMANDS,
  MIX_COMMANDS,
  MUSIC_COMMANDS,
  RENDER_COMMANDS,
  TIMELINE_COMMANDS,
  type AppLocale,
  type RecipeCategory,
} from '@taalcut/core';

/** What has to be on screen for a recipe to make sense: nothing, a project, a cut, a clip or range picked. */
export const RECIPE_NEEDS = ['none', 'project', 'timeline', 'clipSelection'] as const;
export type RecipeNeed = (typeof RECIPE_NEEDS)[number];

export interface Recipe {
  /** 'cut.tighten'. */
  readonly id: string;
  readonly category: RecipeCategory;
  /** The chip: "Tighten the cut". */
  readonly label: MessageDescriptor;
  /** What goes in the composer. */
  readonly prompt: MessageDescriptor;
  readonly needs: RecipeNeed;
  /** The UI languages it shows in ('all': every one, the pseudo-locale too). */
  readonly locales: 'all' | readonly AppLocale[];
  /** Command names a finished run must have dispatched. */
  readonly expects: readonly string[];
}

/** The menu's headings, in RECIPE_CATEGORIES' order. */
export const RECIPE_CATEGORY_LABELS: Readonly<Record<RecipeCategory, MessageDescriptor>> = {
  cut: msg({ message: 'Cut', context: 'recipe group' }),
  captions: msg({ message: 'Captions', context: 'recipe group' }),
  music: msg({ message: 'Music', context: 'recipe group' }),
  graphics: msg({ message: 'Graphics', context: 'recipe group' }),
  style: msg({ message: 'Look', context: 'recipe group' }),
  reframe: msg({ message: 'Reframe', context: 'recipe group' }),
  export: msg({ message: 'Export', context: 'recipe group' }),
};

const T = TIMELINE_COMMANDS;

export const RECIPES: readonly Recipe[] = [
  // Starters: they make something from the library, so they fit an empty chat or project.
  {
    id: 'cut.newReel',
    category: 'cut',
    label: msg`Make a 15-second reel`,
    prompt: msg`Make a 15-second reel from my newest clips, cut on the beat.`,
    needs: 'none',
    locales: 'all',
    expects: [T.create],
  },
  {
    id: 'captions.newReel',
    category: 'captions',
    label: msg`A reel with captions`,
    prompt: msg`Make a short reel from my newest clips, with captions timed to what’s said.`,
    needs: 'none',
    locales: 'all',
    expects: [T.create, CAPTION_COMMANDS.setEnabled],
  },
  {
    id: 'export.newHooks',
    category: 'export',
    label: msg`Try three hooks`,
    prompt: msg`Make a short video from my newest clips in three versions, each with a different hook, so I can compare them.`,
    needs: 'none',
    locales: 'all',
    expects: [T.create],
  },
  // The cut on screen.
  {
    id: 'cut.tighten',
    category: 'cut',
    label: msg`Tighten the cut`,
    prompt: msg`Make the cuts snappier: trim the slow starts and ends of the clips and keep every cut on the beat.`,
    needs: 'timeline',
    locales: 'all',
    expects: [T.trimClip],
  },
  {
    id: 'cut.fifteen',
    category: 'cut',
    label: msg`Make it 15 seconds`,
    prompt: msg`Cut this video down to 15 seconds, keeping the hook and the strongest moments.`,
    needs: 'timeline',
    locales: 'all',
    expects: [T.trimToDuration],
  },
  {
    id: 'cut.swapWeakest',
    category: 'cut',
    label: msg`Swap the weakest shot`,
    prompt: msg`Find the weakest shot in this video and swap it for a better one from my clips.`,
    needs: 'timeline',
    locales: 'all',
    expects: [T.swapClip],
  },
  {
    id: 'captions.add',
    category: 'captions',
    label: msg`Add captions`,
    prompt: msg`Add captions to this video, timed to what’s said.`,
    needs: 'timeline',
    locales: 'all',
    expects: [CAPTION_COMMANDS.setEnabled],
  },
  {
    id: 'captions.bigger',
    category: 'captions',
    label: msg`Bigger captions`,
    prompt: msg`Make the captions bigger and easier to read on a phone.`,
    needs: 'timeline',
    locales: 'all',
    expects: [CAPTION_COMMANDS.setStyle],
  },
  {
    id: 'captions.hindi',
    category: 'captions',
    label: msg`Captions in Hindi`,
    prompt: msg`Put the captions in Hindi, written in Devanagari.`,
    needs: 'timeline',
    locales: ['hi'],
    expects: [CAPTION_COMMANDS.applyTranslation],
  },
  {
    id: 'captions.hinglish',
    category: 'captions',
    label: msg`Captions in Hinglish`,
    prompt: msg`Put the captions in Hinglish: Hindi written in Latin letters, the way people type it.`,
    needs: 'timeline',
    locales: ['hi'],
    expects: [CAPTION_COMMANDS.applyTranslation],
  },
  // Each language's own: its captions, from footage in another language.
  {
    id: 'captions.spanish',
    category: 'captions',
    label: msg`Captions in Spanish`,
    prompt: msg`Put the captions in Spanish.`,
    needs: 'timeline',
    locales: ['es'],
    expects: [CAPTION_COMMANDS.applyTranslation],
  },
  {
    id: 'captions.portuguese',
    category: 'captions',
    label: msg`Captions in Portuguese`,
    prompt: msg`Put the captions in Brazilian Portuguese.`,
    needs: 'timeline',
    locales: ['pt-BR'],
    expects: [CAPTION_COMMANDS.applyTranslation],
  },
  {
    id: 'music.pick',
    category: 'music',
    label: msg`Pick music for this`,
    prompt: msg`Pick music that fits the mood of this video and line the cuts up with its beat.`,
    needs: 'timeline',
    locales: 'all',
    expects: [MUSIC_COMMANDS.choosePath],
  },
  {
    id: 'music.duck',
    category: 'music',
    label: msg`Lower music under my voice`,
    prompt: msg`Lower the music whenever I’m speaking, so my voice comes through clearly.`,
    needs: 'timeline',
    locales: 'all',
    expects: [MIX_COMMANDS.setDucking],
  },
  {
    id: 'music.hits',
    category: 'music',
    label: msg`Add hits on the cuts`,
    prompt: msg`Add short sound hits on the main cuts.`,
    needs: 'timeline',
    locales: 'all',
    expects: [MIX_COMMANDS.setHits],
  },
  {
    id: 'graphics.title',
    category: 'graphics',
    label: msg`Add a title`,
    prompt: msg`Add a title at the start that says what this video is about.`,
    needs: 'timeline',
    locales: 'all',
    expects: [GRAPHICS_COMMANDS.placeComposition],
  },
  {
    id: 'graphics.lowerThird',
    category: 'graphics',
    label: msg`Add a lower third with my name`,
    prompt: msg`Add a lower third with my name the first time I’m on screen.`,
    needs: 'timeline',
    locales: 'all',
    expects: [GRAPHICS_COMMANDS.placeComposition],
  },
  {
    id: 'graphics.callout',
    category: 'graphics',
    label: msg`Add a callout here`,
    prompt: msg`Add a callout on what I picked that points out what matters in it.`,
    needs: 'clipSelection',
    locales: 'all',
    expects: [GRAPHICS_COMMANDS.placeComposition],
  },
  {
    id: 'style.brandKit',
    category: 'style',
    label: msg`Use my brand kit`,
    prompt: msg`Give this video my brand kit’s look: its colours, fonts, caption style, intro and outro.`,
    needs: 'timeline',
    locales: 'all',
    expects: [T.setStyle],
  },
  {
    id: 'style.matchReference',
    category: 'style',
    label: msg`Match the look of my reference`,
    prompt: msg`Match the colour and the caption look of my reference video.`,
    needs: 'timeline',
    locales: 'all',
    expects: [T.setStyle],
  },
  {
    id: 'reframe.vertical',
    category: 'reframe',
    label: msg`Make it vertical`,
    prompt: msg`Reframe this video to vertical 9:16 and keep what matters in frame.`,
    needs: 'timeline',
    locales: 'all',
    expects: [T.setReframe],
  },
  {
    id: 'reframe.faces',
    category: 'reframe',
    label: msg`Keep faces in frame`,
    prompt: msg`Reframe the clips so faces always stay in frame.`,
    needs: 'timeline',
    locales: 'all',
    expects: [T.setReframe],
  },
  {
    id: 'export.shorts',
    category: 'export',
    label: msg`Export for Shorts`,
    prompt: msg`Export this video for YouTube Shorts.`,
    needs: 'timeline',
    locales: 'all',
    expects: [RENDER_COMMANDS.export],
  },
  {
    id: 'export.hookVariants',
    category: 'export',
    label: msg`Make 3 hook variants`,
    prompt: msg`Make three versions of this video with different hooks, so I can compare them side by side.`,
    needs: 'timeline',
    locales: 'all',
    expects: [T.create],
  },
  {
    id: 'export.finalCut',
    category: 'export',
    label: msg`Export for Final Cut`,
    prompt: msg`Export this timeline for Final Cut Pro, as an FCPXML file.`,
    needs: 'timeline',
    locales: 'all',
    expects: [T.exportInterchange],
  },
];
