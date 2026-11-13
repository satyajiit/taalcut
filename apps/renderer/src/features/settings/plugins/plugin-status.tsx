// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans } from '@lingui/react/macro';
import type { PluginView } from '@taalcut/core';
import { Chip } from '@taalcut/ui';
import { Puzzle } from 'lucide-react';

/** Logos are bundled assets; a registry response cannot make the renderer fetch a remote image. */
export function PluginLogo({ logo, large = false }: { logo: string; large?: boolean }) {
  const className = large ? 'size-16 shrink-0 rounded-lg' : 'size-12 shrink-0 rounded-md';
  if (logo === 'postiz') {
    return <img src="/plugins/postiz.svg" alt="" aria-hidden className={className} />;
  }
  if (logo === 'instagram-edits') {
    return <img src="/plugins/instagram-edits.svg" alt="" aria-hidden className={className} />;
  }
  return <Puzzle aria-hidden className={`${className} text-ink-2`} />;
}

export function PluginStatus({ plugin }: { plugin: PluginView }) {
  if (plugin.status === 'active')
    return (
      <Chip tone="success">
        <Trans>Active</Trans>
      </Chip>
    );
  if (plugin.status === 'error')
    return (
      <Chip tone="danger">
        <Trans>Needs attention</Trans>
      </Chip>
    );
  if (plugin.status === 'inactive')
    return (
      <Chip tone="neutral">
        <Trans>Inactive</Trans>
      </Chip>
    );
  return (
    <Chip tone="neutral">
      <Trans>Not connected</Trans>
    </Chip>
  );
}
