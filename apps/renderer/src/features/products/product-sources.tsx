// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · DESIGN.md: source provenance stays visible as links and read-only folder grants.
 * States: empty, staged attachment, picker pending/failure, disabled; additions arrive without moving context. */

import { useLingui } from '@lingui/react/macro';
import { callRpc, newId, type ProductSource, type TaalcutError } from '@taalcut/core';
import {
  Button,
  Checkbox,
  CONCEPT_ICONS,
  Input,
  MediaError,
  Select,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { Field } from '../settings/fields';
import { ProductArrival } from './product-layout';

export function ProductSources({
  sources,
  onChange,
  disabled,
}: {
  sources: ProductSource[];
  onChange: (sources: ProductSource[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const Source = CONCEPT_ICONS.source;
  const backend = useBackend();
  const [url, setUrl] = useState('');
  const [purpose, setPurpose] = useState<'website' | 'social' | 'reference'>('website');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const busy = disabled || picking;
  const addUrl = () => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) return;
    onChange([
      ...sources,
      {
        id: newId<'CreationSource'>(),
        kind: 'url',
        label: parsed.hostname,
        url: parsed.href,
        purpose,
        liveCapture: false,
      },
    ]);
    setUrl('');
  };
  return (
    <section
      className="flex min-w-0 flex-col gap-5 border-t border-rule pt-7"
      aria-label={t`Product sources`}
    >
      <div>
        <h2 className="m-0 flex items-center gap-2 type-section text-ink">
          <Source aria-hidden className="size-5 text-ink-2" />
          {t`Sources`}
        </h2>
        <p className="mt-1 mb-0 type-body text-ink-2">{t`Attach the project folders, website and social pages that explain this product.`}</p>
      </div>
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Field htmlFor="product-source-url" label={t`Website or social URL`}>
          <Input
            id="product-source-url"
            type="url"
            value={url}
            disabled={busy}
            maxLength={4000}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <Select
          aria-label={t`Source type`}
          value={purpose}
          disabled={busy}
          onChange={(event) => setPurpose(event.target.value as typeof purpose)}
        >
          <option value="website">{t`Website`}</option>
          <option value="social">{t`Social page`}</option>
          <option value="reference">{t`Reference`}</option>
        </Select>
        <Button
          type="button"
          icon={VERB_ICONS.copyLink}
          disabled={busy || !/^https?:\/\//.test(url)}
          onClick={addUrl}
        >{t`Add link`}</Button>
      </div>
      <Button
        type="button"
        className="self-start"
        icon={VERB_ICONS.addFolder}
        loading={picking}
        disabled={busy}
        onClick={async () => {
          setPicking(true);
          setError(null);
          try {
            const result = await callRpc(backend.files.pickCreationDirectory());
            if (!result.ok) setError(result.error);
            else if (result.value)
              onChange([
                ...sources,
                {
                  ...result.value,
                  id: newId<'CreationSource'>(),
                  kind: 'directory',
                  purpose: 'repository',
                  liveCapture: false,
                },
              ]);
          } finally {
            setPicking(false);
          }
        }}
      >{t`Attach project folder`}</Button>
      {error ? <MediaError error={error} /> : null}
      {sources.map((source) => (
        <ProductArrival key={source.id} className="flex min-w-0 flex-col gap-3 border-b border-rule pb-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <UserContent className="block truncate type-label text-ink">{source.label}</UserContent>
              {source.url ? (
                <UserContent className="block truncate type-meta text-ink-2">{source.url}</UserContent>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon={VERB_ICONS.delete}
              disabled={busy}
              onClick={() => onChange(sources.filter((item) => item.id !== source.id))}
            >{t`Remove`}</Button>
          </div>
          {source.kind === 'directory' ? (
            <Checkbox
              label={t`Allow isolated live demo capture`}
              disabled={busy}
              checked={source.liveCapture}
              onCheckedChange={(liveCapture) =>
                onChange(sources.map((item) => (item.id === source.id ? { ...item, liveCapture } : item)))
              }
            />
          ) : null}
        </ProductArrival>
      ))}
      <p className="m-0 type-meta text-ink-2">{t`Project files are read-only. Live capture runs a separate copy only when enabled.`}</p>
    </section>
  );
}
