// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { SocialChapter, ThumbnailArchetype, ThumbnailTheme } from '@taalcut/core';

export interface SocialMetadataPartial {
  readonly researchSummary?: readonly string[];
  readonly youtube?: {
    readonly title?: string;
    readonly titleAlternates?: readonly string[];
    readonly description?: string;
    readonly tags?: readonly string[];
    readonly chapters?: readonly SocialChapter[];
  };
  readonly instagram?: {
    readonly hookLine?: string;
    readonly caption?: string;
    readonly hashtags?: readonly string[];
  };
  readonly tiktok?: {
    readonly caption?: string;
    readonly seoKeywords?: readonly string[];
    readonly hashtags?: readonly string[];
  };
}

export interface SocialMetadataInput extends SocialMetadataPartial {
  readonly topic?: string;
  readonly hookText?: string;
  readonly prompt?: string;
  readonly kickerText?: string;
  readonly statBadge?: string;
  readonly durationBadge?: string;
  readonly archetype?: ThumbnailArchetype;
  readonly theme?: ThumbnailTheme;
  readonly style?: string;
  readonly vibe?: string;
  readonly targetAudience?: string;
  readonly audience?: string;
  readonly transcript?: string;
  readonly keywords?: readonly string[];
  readonly chapters?: readonly SocialChapter[];
  readonly channel?: {
    readonly name?: string;
    readonly handle?: string;
  };
  readonly social?: SocialMetadataPartial;
}
