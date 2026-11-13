// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { SocialMetadataPack } from '@taalcut/core';
import { Button } from '#components/button';
import { UserContent } from './card-frame';

export function ProductSocialMeta({
  social,
  copy,
}: {
  readonly social: SocialMetadataPack;
  readonly copy: (key: string, text: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const sections = [
    { key: 'x', label: t`X post`, text: social.x?.text },
    { key: 'linkedin', label: t`LinkedIn post`, text: social.linkedin?.text },
    {
      key: 'facebook',
      label: t`Facebook post`,
      text: social.facebook ? `${social.facebook.title}\n\n${social.facebook.description}` : undefined,
    },
  ];
  return sections
    .filter((section) => section.text)
    .map((section) => (
      <div
        key={section.key}
        data-slot={`social-block-${section.key}`}
        className="flex flex-col gap-2 rounded-lg border border-rule bg-sunken p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="type-card-title">{section.label}</span>
          <Button size="sm" variant="ghost" onClick={() => void copy(section.key, section.text!)}>
            {t`Copy`}
          </Button>
        </div>
        <p className="m-0 whitespace-pre-wrap type-body">
          <UserContent translate="no">{section.text}</UserContent>
        </p>
      </div>
    ));
}
