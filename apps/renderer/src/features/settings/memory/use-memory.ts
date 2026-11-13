// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Memory's data (LRN1-MEM): the remembered items (`memory.list`, searched by the box's words) and the
 * status line (`memory.status`), kept current from the bus. A memory command from this page, the agent's
 * "Remember this?", an export's learned item or an undo arrives as `library.changed` (entity 'memory'); the cloud
 * switch and Local only as `command.changed`; so do changes to the models, which move where prompts go.
 */
import type { MemoryList, MemoryStatus } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery, type Reloadable } from '../../../backend/use-rpc';

/** The search waits this long after the last key. */
const SEARCH_MS = 200;
/** Commands whose change moves the status line (the switch, Local only, the agent's model). */
const STATUS_COMMANDS = /^(memory\.setCloudPrompts|privacy\.setLocalOnly|models\.)/;

export interface MemoryData {
  readonly items: Reloadable<MemoryList>;
  readonly status: Reloadable<MemoryStatus>;
  /** The search box's words, as typed. */
  readonly query: string;
  setQuery(query: string): void;
  /** The words the list was read for (the box's, once it settles). */
  readonly searched: string;
}

export function useMemory(): MemoryData {
  const backend = useBackend();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearched(query.trim()), SEARCH_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const items = useRpcQuery(
    (signal) => backend.memory.list(searched ? { query: searched } : {}, { signal }),
    [backend, searched],
  );
  const status = useRpcQuery((signal) => backend.memory.status(undefined, { signal }), [backend]);

  useBackendEvents(['library.changed', 'command.changed'], (event) => {
    if (event.type === 'library.changed') {
      if (event.payload.entity === 'memory') {
        items.reload();
        status.reload();
      }
      return;
    }
    if (STATUS_COMMANDS.test(event.payload.name)) status.reload();
  });

  return { items, status, query, setQuery, searched };
}
