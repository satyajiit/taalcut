// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { CreatorProfile } from '@taalcut/core';
import { Checkbox } from '@taalcut/ui';
import { CommitInput } from './commit-fields';
import type { StyleEditor } from './use-style-editor';

/** Identity is supplied by the creator; changing a destination clears its old confirmation. */
export function CreatorFields({ editor }: { editor: Pick<StyleEditor, 'style' | 'commit'> }) {
  const { t } = useLingui();
  const creator = editor.style?.creator;
  const change = (field: keyof CreatorProfile, value: string | boolean) =>
    editor.commit(`creator.${field}`, (style) => ({
      creator: {
        profileLinkConfirmed: false,
        ...style.creator,
        [field]: typeof value === 'string' ? value.trim() || undefined : value,
        ...(field === 'profileLinkUrl' ? { profileLinkConfirmed: false } : {}),
      },
    }));
  const https = (value: string) => {
    if (!value.trim()) return null;
    try {
      return new URL(value).protocol === 'https:' ? null : t`Use a secure https link.`;
    } catch {
      return t`Enter a complete https link.`;
    }
  };
  const fields = [
    { key: 'name', label: t`Creator or channel name`, max: 80 },
    { key: 'youtubeHandle', label: t`YouTube handle`, max: 100 },
    { key: 'instagramHandle', label: t`Instagram handle`, max: 100 },
    { key: 'youtubeUrl', label: t`YouTube channel link`, max: 2048, url: true },
    { key: 'profileLinkUrl', label: t`Instagram profile destination link`, max: 2048, url: true },
    { key: 'tone', label: t`Voice and tone`, max: 240 },
    { key: 'audience', label: t`Who you make videos for`, max: 240 },
    { key: 'cta', label: t`Preferred ending text`, max: 160 },
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <CommitInput
            key={field.key}
            label={field.label}
            value={creator?.[field.key] ?? ''}
            maxLength={field.max}
            userContent
            validate={'url' in field ? https : undefined}
            onCommit={(value) => change(field.key, value)}
          />
        ))}
      </div>
      <Checkbox
        label={t`I have added this destination to my Instagram profile`}
        description={t`Taalcut only mentions a full-video profile link when its destination matches the source video.`}
        checked={creator?.profileLinkConfirmed ?? false}
        disabled={!creator?.profileLinkUrl}
        onCheckedChange={(value) => void change('profileLinkConfirmed', value)}
      />
    </div>
  );
}
