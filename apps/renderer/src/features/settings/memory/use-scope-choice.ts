// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Memory's scope choice (LRN1-MEM): the kind and, for a project or template, which one, with the picker's
 * search over the existing ones. Projects come from `projects.list` (the newest 200, as Make lists them) and match
 * the words here; templates from `templates.list`, searched by the library with the words. Each list is read only
 * while its picker is open.
 */
import type { MemoryScope } from '@taalcut/core';
import type {
  MemoryScopeFieldProps,
  MemoryScopeKind,
  MemoryScopeOption,
  MemoryScopePickerProps,
} from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { matching, scopeOf, type ScopeChoice } from './memory-scope';

/** The template search waits this long after the last key. */
const SEARCH_MS = 200;
const PROJECTS_SHOWN = 200;
const TEMPLATES_SHOWN = 50;

export interface ScopeChoiceState {
  readonly choice: ScopeChoice;
  /** The scope chosen; null while a project or template is still to be chosen. */
  readonly scope: MemoryScope | null;
  /** MemoryScopeField's props, but `disabled` and `disabledKinds`. */
  readonly field: Pick<MemoryScopeFieldProps, 'kind' | 'onKindChange' | 'picker'>;
}

export function useScopeChoice(initial: ScopeChoice): ScopeChoiceState {
  const [choice, setChoice] = useState(initial);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { kind } = choice;
  const read = useScopeOptions(kind, open, query);

  const onKindChange = (next: MemoryScopeKind) => {
    setChoice({ kind: next, target: null });
    setQuery('');
  };
  return {
    choice,
    scope: scopeOf(choice),
    field: {
      kind,
      onKindChange,
      picker: {
        value: choice.target,
        open,
        onOpenChange: setOpen,
        query,
        onQueryChange: setQuery,
        ...read,
        onPick: (target) => {
          setChoice({ kind, target });
          setOpen(false);
        },
      },
    },
  };
}

/** The projects or templates matching the query, read while the picker is open; null while they load. */
function useScopeOptions(
  kind: MemoryScopeKind,
  open: boolean,
  query: string,
): Pick<MemoryScopePickerProps, 'options' | 'error' | 'onRetry'> {
  const backend = useBackend();
  const [searched, setSearched] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), SEARCH_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const projects = useRpcQuery(
    (signal) =>
      open && kind === 'project'
        ? backend.projects.list({ archived: false, limit: PROJECTS_SHOWN }, { signal })
        : Promise.resolve(null),
    [backend, open, kind],
  );
  const templates = useRpcQuery(
    (signal) =>
      open && kind === 'template'
        ? backend.templates.list(
            { ...(searched ? { query: searched } : {}), limit: TEMPLATES_SHOWN },
            { signal },
          )
        : Promise.resolve(null),
    [backend, open, kind, searched],
  );

  const read = kind === 'project' ? projects : templates;
  // Only an answer for these words and this kind is shown; while the next loads, the list shows its bones.
  const current: MemoryScopeOption[] | null =
    read.status === 'ready' && read.data ? read.data.items.map(({ id, name }) => ({ id, name })) : null;
  return {
    options: current && kind === 'project' ? matching(current, query) : current,
    error: read.status === 'error' ? read.error : null,
    onRetry: read.reload,
  };
}
