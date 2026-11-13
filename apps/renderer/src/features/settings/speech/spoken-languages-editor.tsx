// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the languages you speak (LIB1-LANG) · genre: atmospheric studio app (chrome modern-minimal) ·
 *   system: DESIGN.md v0.7 + UX4 (the kit's ListRows, Select and Button; Settings' glyphs)
 * the languages Taalcut listens for first, one dense static row each in a raised list: named in the window's
 *   language, with its own name under it (`lang` set), Remove at the row's end (not on the last one). Under the
 *   list, one line: a native select of the other languages by name, then Add. While these languages need the
 *   Indian-language identifier, one row for it under them: its name says why it comes, then its size and where its
 *   download is, with Download when it never started or stopped on a problem, and a link to Settings › Models.
 *   Shared by Settings › General and first run's Your videos step (`compact`: no identifier link, the step's own).
 * states: loading (lines) · error (LoadError) · default (not answered: the app's language and English, said so) ·
 *   answered · saving (the list is aria-busy, the controls wait, the pressed one spins) · full (eight: the select
 *   and Add wait, said why) · error (ErrorLine under it) · identifier: in the download, downloading (its percent),
 *   paused with the downloads, stopped (DownloadErrorLine), on this Mac · success (polite announcement)
 * contrast: names ink, own names and lines ink-2 (≥ 7:1); the select and buttons are the kit's */
import { Trans, useLingui } from '@lingui/react/macro';
import { SPOKEN_LANGUAGE_CHOICES, type SpokenLanguage } from '@taalcut/core';
import { Button, ErrorLine, ListRow, ListRows, Select, SkeletonLines, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';
import { DownloadErrorLine } from '../../downloads/download-error-line';
import { formatProgress } from '../../downloads/download-format';
import { downloadsAnchor } from '../../downloads/downloads-anchor';
import { formatBytes, formatLanguage } from '../../shared/format';
import { LoadError } from '../fields';
import { SETTINGS_ICONS } from '../settings-icons';
import { useSpokenLanguages } from './use-spoken-languages';

/** A language's name in itself ("ଓଡ଼ିଆ"), or null when the window's name already is it or none is known. */
function ownName(tag: string, shown: string): string | null {
  try {
    const own = new Intl.DisplayNames([tag], { type: 'language' }).of(tag);
    return own && own !== tag && own.toLocaleLowerCase(tag) !== shown.toLocaleLowerCase(tag) ? own : null;
  } catch {
    return null;
  }
}

type Spoken = ReturnType<typeof useSpokenLanguages>;

/** The identifier's row: why it comes (its name), its size, where its download is. */
function IdentifierRow({ spoken, compact }: { spoken: Spoken; compact: boolean }) {
  const { t, i18n } = useLingui();
  const identifier = spoken.identifier;
  if (!spoken.needed || !identifier) return null;
  const size = formatBytes(i18n, identifier.sizeBytes);
  const percent = formatProgress(i18n, identifier.progress ?? 0);
  const status = identifier.status;
  const words =
    status === 'installed'
      ? t`On this Mac`
      : status === 'downloading'
        ? t`Downloading · ${percent}`
        : status === 'paused' || spoken.downloadsPaused
          ? t`Waiting in Downloads, which are paused`
          : status === 'queued'
            ? t`In Downloads, next`
            : status === 'failed'
              ? t`Stopped`
              : t`Not downloaded yet`;
  const startable = status === 'not-installed' || status === 'failed';
  return (
    <div className="flex flex-col gap-1.5">
      <ListRows framed aria-label={t`Language identifier`}>
        <ListRow
          size="dense"
          static
          data-slot="spoken-identifier"
          leading={SETTINGS_ICONS.models}
          title={<span translate="no">{identifier.name}</span>}
          meta={
            <span>
              <span className="tabular-nums">{size}</span> · {words}
            </span>
          }
          actions={
            startable && !spoken.downloadsPaused ? (
              <Button
                size="sm"
                variant="ghost"
                icon={VERB_ICONS.download}
                data-action="download-identifier"
                onClick={() => void spoken.download()}
              >
                <Trans>Download</Trans>
              </Button>
            ) : undefined
          }
        />
      </ListRows>
      {identifier.error ? <DownloadErrorLine error={identifier.error} /> : null}
      {compact ? null : (
        <p className="m-0 type-caption text-ink-2">
          <Trans>
            It comes with your other models, in{' '}
            <Link
              to="/settings/models"
              hash={downloadsAnchor('speech')}
              className="font-medium text-ink underline underline-offset-4"
            >
              Settings › Models
            </Link>
            .
          </Trans>
        </p>
      )}
    </div>
  );
}

export function SpokenLanguagesEditor({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useLingui();
  const spoken = useSpokenLanguages();
  const selectId = useId();
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const collator = useMemo(() => new Intl.Collator(i18n.locale), [i18n.locale]);
  const others = useMemo(
    () =>
      SPOKEN_LANGUAGE_CHOICES.filter((tag) => !spoken.languages.includes(tag))
        .map((tag) => ({ tag, name: formatLanguage(i18n, tag) }))
        .sort((a, b) => collator.compare(a.name, b.name)),
    [spoken.languages, i18n, collator],
  );

  if (spoken.loadError)
    return <LoadError error={spoken.loadError} what={<Trans>Your languages didn’t load.</Trans>} />;
  if (spoken.loading) return <SkeletonLines lines={2} />;

  const run = async (key: string, change: () => Promise<boolean>, announce: string) => {
    setBusy(key);
    const done = await change();
    setBusy(null);
    if (done) setSaid(announce);
    return done;
  };
  const add = async () => {
    const picked = others.find((each) => each.tag === choice);
    if (!picked) return;
    const { name } = picked;
    if (await run('add', () => spoken.add(picked.tag as SpokenLanguage), t`${name} added.`)) setChoice('');
  };

  return (
    <div className="flex flex-col gap-3" data-slot="spoken-languages">
      <ListRows framed aria-label={t`Languages you speak`} aria-busy={spoken.pending || undefined}>
        {spoken.languages.map((tag) => {
          const name = formatLanguage(i18n, tag);
          const own = ownName(tag, name);
          const nameId = `${selectId}-${tag}`;
          return (
            <ListRow
              key={tag}
              size="dense"
              static
              data-language={tag}
              title={<span id={nameId}>{name}</span>}
              meta={
                own ? (
                  <span lang={tag} translate="no">
                    {own}
                  </span>
                ) : undefined
              }
              actions={
                spoken.languages.length > 1 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={VERB_ICONS.forget}
                    data-action="remove-language"
                    loading={busy === tag}
                    disabled={busy !== null && busy !== tag}
                    aria-label={t`Remove ${name}`}
                    onClick={() => void run(tag, () => spoken.remove(tag), t`${name} removed.`)}
                  >
                    <Trans>Remove</Trans>
                  </Button>
                ) : undefined
              }
            />
          );
        })}
      </ListRows>
      {spoken.answered === null ? (
        <p className="m-0 type-caption text-ink-2">
          <Trans>Until you choose, these are Taalcut’s language and English.</Trans>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          {t`Add a language`}
        </label>
        <Select
          id={selectId}
          wrapperClassName="w-auto min-w-[14rem] max-w-full"
          value={choice}
          disabled={spoken.full || busy !== null}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="">{t`Add a language…`}</option>
          {others.map(({ tag, name }) => (
            <option key={tag} value={tag}>
              {name}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="secondary"
          icon={VERB_ICONS.add}
          data-action="add-language"
          loading={busy === 'add'}
          disabled={!choice || spoken.full || (busy !== null && busy !== 'add')}
          onClick={() => void add()}
        >
          <Trans>Add</Trans>
        </Button>
      </div>
      {spoken.full ? (
        <p className="m-0 type-caption text-ink-2">
          <Trans>That’s eight, the most Taalcut listens for. Remove one to add another.</Trans>
        </p>
      ) : null}
      <IdentifierRow spoken={spoken} compact={compact} />
      {spoken.error ? <ErrorLine error={spoken.error} /> : null}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}
