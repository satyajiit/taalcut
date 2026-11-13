// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · page: Settings › Memory (LRN1-MEM) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 + UX4 · layout: the kit's PageSections. What Taalcut remembers: the add field with where it applies
 *   and Add (the screen's one marigold fill; memory-add.tsx), the search box once there is anything to search, then
 *   the items grouped by where they apply.
 *   Cloud models: the switch and one plain sentence on where memory goes now. Teal marks what you wrote, violet
 *   what the agent proposed or Taalcut learned (MemorySourceBadge), each with its word.
 * states: loading (named skeletons captured from the rows) · empty (the kit's EmptyState with Kaatu: add one here
 *   or tell the agent; Start a chat) · error (the cause and Try again) · adding (Add spins, the field waits) · add failed (the cause
 *   under the field) · searching (the list stays while the next one loads) · no match (one line) · each row's own
 *   (MemoryItem) · success (silent: the list re-reads; a deletion's toast has Undo)
 * motion: none of its own; the bones pulse while loading (the kit's tc-bone). One primitive.
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, EmptyState, Input, PageSection, Skeleton, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { BoneRows } from '../bones';
import { LoadError } from '../fields';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsPage } from '../settings-page';
import { AddField } from './memory-add';
import { MemoryCloud } from './memory-cloud';
import { MemoryListView } from './memory-list';
import { useMemory } from './use-memory';
import { useMemoryActions } from './use-memory-actions';

const LIST_BONES = [
  { title: '58%', lines: ['18%'], control: 'button' },
  { title: '72%', lines: ['22%'], control: 'button' },
  { title: '40%', lines: ['16%'], control: 'button' },
] as const;

function Empty() {
  return (
    <EmptyState
      titleAs="h3"
      icon={SETTINGS_ICONS.memory}
      title={<Trans>Nothing remembered yet</Trans>}
      description={
        <Trans>Add something above, or tell the agent in a chat and say yes when it asks “Remember this?”.</Trans>
      }
      action={
        <Button asChild variant="secondary" size="sm" icon={VERB_ICONS.newChat}>
          <Link to="/chat">
            <Trans>Start a chat</Trans>
          </Link>
        </Button>
      }
    />
  );
}

export function MemorySettings({ now }: { now?: number }) {
  const { t } = useLingui();
  const memory = useMemory();
  const actions = useMemoryActions();
  const list = memory.items.data;
  const loading = !list && memory.items.status !== 'error';
  const searchable = Boolean(memory.query) || (list?.total ?? 0) > 0;

  return (
    <SettingsPage
      title={t`Memory`}
      description={<Trans>What Taalcut remembers about how you like your videos.</Trans>}
    >
      <PageSection
        title={<Trans>What Taalcut remembers</Trans>}
        icon={SETTINGS_ICONS.memory}
        description={
          <Trans>
            The agent reads these when a chat starts. What you write here, it follows. What it proposed or
            learned from your exports, it weighs as a note.
          </Trans>
        }
      >
        <AddField actions={actions} />
        {searchable ? (
          <div className="relative max-w-sm">
            <Search aria-hidden className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-3" />
            <Input
              type="search"
              className="pl-9"
              value={memory.query}
              onChange={(event) => memory.setQuery(event.target.value)}
              aria-label={t`Search memory`}
              placeholder={t`Search memory`}
              aria-busy={memory.items.status === 'loading' || undefined}
            />
          </div>
        ) : null}
        <Skeleton name="settings-memory" loading={loading} fixture={<BoneRows rows={LIST_BONES} />}>
          {memory.items.status === 'error' && !list ? (
            <LoadError
              error={memory.items.error}
              onRetry={memory.items.reload}
              what={<Trans>Your memory didn’t load.</Trans>}
            />
          ) : list ? (
            list.total === 0 && !memory.searched ? (
              <Empty />
            ) : (
              <MemoryListView
                list={list}
                searched={memory.searched}
                actions={actions}
                {...(now === undefined ? {} : { now })}
              />
            )
          ) : null}
        </Skeleton>
      </PageSection>

      <PageSection
        title={<Trans>Cloud models</Trans>}
        icon={SETTINGS_ICONS.cloud}
        description={
          <Trans>
            When the agent works with a cloud model, what it remembers goes with its requests. You decide
            whether it does.
          </Trans>
        }
      >
        <MemoryCloud status={memory.status} actions={actions} />
      </PageSection>
    </SettingsPage>
  );
}
