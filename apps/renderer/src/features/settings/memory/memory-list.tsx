// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: Settings › Memory › the list (LRN1-MEM) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.3 · the items grouped by where they apply: "Every video" first, then each
 *   project and each template by name (user content), each group one grouped hairline frame of rows (MemoryItem:
 *   the words, who they came from, when, Edit and Delete). Editing shows where the item applies too, so it can move
 *   to another scope (the choices it can't take, disabled). A search that finds nothing says so in one line
 *   LRN1-PREF: the learned casting weights' item is CastingWeightsRow (its lean, Adjust and Reset)
 * states: each row's own (MemoryItem) · no match (one line naming the words) · a list past what one read holds
 *   (one line: the newest shown, how many there are)
 */
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { MEMORY_TEXT_MAX, type MemoryItemView, type MemoryList } from '@taalcut/core';
import { MemoryItem, MemoryScopeField, UserContent } from '@taalcut/ui';
import { useId } from 'react';
import { SettingRows } from '../rows';
import { CastingWeightsOr } from './casting-weights-row';
import { memoryGroups, type MemoryGroup } from './memory-groups';
import { choiceOf, disabledKinds } from './memory-scope';
import type { MemoryActions } from './use-memory-actions';
import { useScopeChoice } from './use-scope-choice';

interface ItemProps {
  readonly item: MemoryItemView;
  readonly actions: MemoryActions;
  readonly now?: number;
}

function rowProps({ item, actions, now }: ItemProps) {
  return {
    item,
    max: MEMORY_TEXT_MAX,
    busy: actions.busyOf(item.id),
    disabled: actions.anyBusy && actions.busyOf(item.id) === null,
    error: actions.errorOf(item.id),
    onEdit: () => actions.edit(item.id),
    onCancel: actions.cancel,
    onDelete: () => void actions.remove(item),
    ...(now === undefined ? {} : { now }),
  };
}

/** The item being edited: its words and where it applies, starting from where it is now. */
function EditingItem(props: ItemProps) {
  const { item, actions } = props;
  const where = useScopeChoice(choiceOf(item));
  return (
    <MemoryItem
      {...rowProps(props)}
      editing
      scopeField={
        <MemoryScopeField
          {...where.field}
          disabledKinds={disabledKinds(item)}
          disabled={actions.busyOf(item.id) === 'save'}
        />
      }
      scopeReady={where.scope !== null}
      onSave={(text) => {
        if (where.scope) void actions.save(item, text, where.scope);
      }}
    />
  );
}

function GroupHeading({ group, id }: { group: MemoryGroup; id: string }) {
  const name = group.name ? <UserContent translate="no">{group.name}</UserContent> : null;
  return (
    <h3 id={id} className="m-0 type-label text-ink-2">
      {group.kind === 'user' ? (
        <Trans>Every video</Trans>
      ) : group.kind === 'project' ? (
        name ? (
          <Trans>Project · {name}</Trans>
        ) : (
          <Trans>A project</Trans>
        )
      ) : name ? (
        <Trans>Template · {name}</Trans>
      ) : (
        <Trans>A template</Trans>
      )}
    </h3>
  );
}

/**
 * One group: its heading, and its rows as a list named by that heading (`aria-labelledby`), so a project's or a
 * template's name stays the person's words inside the heading's UserContent, never an attribute.
 */
function MemoryGroupRows({ group, actions, now }: { group: MemoryGroup } & Omit<ItemProps, 'item'>) {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-2" data-memory-group={group.kind}>
      <GroupHeading group={group} id={headingId} />
      <SettingRows aria-labelledby={headingId}>
        {group.items.map((item) => (
          // The memory card's own anatomy (packages/ui MemoryItem) in the settings frame's row.
          <li key={item.id} className="border-t border-rule-subtle px-3 py-2.5 first:border-t-0">
            {/* LRN1-PREF: the learned casting weights' item is their own row, with its editor and Reset. */}
            <CastingWeightsOr item={item} actions={actions} now={now}>
              {actions.editing === item.id ? (
                <EditingItem item={item} actions={actions} {...(now === undefined ? {} : { now })} />
              ) : (
                <MemoryItem
                  {...rowProps({ item, actions, ...(now === undefined ? {} : { now }) })}
                  editing={false}
                  onSave={() => undefined}
                />
              )}
            </CastingWeightsOr>
          </li>
        ))}
      </SettingRows>
    </div>
  );
}

export function MemoryListView({
  list,
  searched,
  actions,
  now,
}: {
  list: MemoryList;
  searched: string;
  actions: MemoryActions;
  now?: number;
}) {
  const { t } = useLingui();
  if (searched && list.items.length === 0)
    return (
      <p className="m-0 type-body text-ink-2">
        <Trans>
          Nothing in memory matches “<UserContent translate="no">{searched}</UserContent>”.
        </Trans>
      </p>
    );
  const shown = list.items.length;
  return (
    <div className="flex flex-col gap-5">
      {memoryGroups(list.items).map((group) => (
        <MemoryGroupRows
          key={group.key}
          group={group}
          actions={actions}
          {...(now === undefined ? {} : { now })}
        />
      ))}
      {!searched && list.total > shown ? (
        <p className="m-0 type-body text-ink-2">
          {t`Showing the newest ${shown} of ${plural(list.total, { one: '# item', other: '# items' })}. Search to find the others.`}
        </p>
      ) : null}
    </div>
  );
}
