// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useEffect, useRef } from 'react';
import { useEditorContext } from './editor-context';

/** A repeated edit request refocuses the words without remounting or discarding a draft. */
export function useEditorTextFocus(itemId: string) {
  const container = useRef<HTMLDivElement>(null);
  const request = useEditorContext()?.textEditRequest;
  useEffect(() => {
    if (request?.itemId !== itemId) return;
    const field = container.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      'textarea, input:not([inputmode]):not([type="color"]):not([type="checkbox"])',
    );
    field?.focus({ preventScroll: true });
    field?.select();
  }, [itemId, request]);
  return container;
}
