// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the clip's spoken language (LIB1-LANG) · system: DESIGN.md v0.7 + UX4 (the facts card's
 *   rows, the kit's Popover, Select and Button)
 * Sound's first row when someone speaks: the language as Taalcut heard it, with the AI mark ("Hindi speech", "Hindi
 *   and English speech", "Speech, language unclear"), or as the person set it; the codec under it, as before. Under
 *   that, the you chip ("Set by you") once set, and Change, so the words keep the column's width. Change opens a
 *   small popover: the language as a native select (the languages you speak first, then the rest by name), one line
 *   on what changing it does (the transcript is made again in it, or, for a language nothing here writes out, the
 *   honest line), Use it, and, once set, Use what Taalcut heard
 * states: detected · mixed · unclear · chosen · checking (heard before LIB1: the old guess is held back until Taalcut
 *   decides again, "Speech, checking the language", no AI mark) · no outcome yet (the clip's language only) · Change:
 *   closed, open (focus on the select), saving (Use spins, the rest waits), error (ErrorLine in the popover),
 *   success (the popover closes, focus back on Change, announced politely; ⌘Z undoes it)
 * contrast: the row's as the facts card's; the popover's words ink and ink-2 on the overlay surface */
import { useLingui } from '@lingui/react/macro';
import {
  LIBRARY_COMMANDS,
  spokenLanguagesOrDefault,
  SPOKEN_LANGUAGE_CHOICES,
  type AssetDetail,
  type SpokenLanguage,
} from '@taalcut/core';
import {
  AiMark,
  Button,
  Chip,
  ErrorLine,
  listOf,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  VERB_ICONS,
} from '@taalcut/ui';
import { AudioLines } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { useBackend } from '../../../../backend/backend';
import { useCommand } from '../../../../backend/use-command';
import { useRpcQuery } from '../../../../backend/use-rpc';
import { useLocaleState } from '../../../../i18n/use-locale';
import { formatLanguage } from '../../../shared/format';
import { Fact, Lead } from './fact-row';

/** The languages nothing here writes out yet (packages/audio SPEC.md): their transcript step is skipped. */
const UNWRITTEN: ReadonlySet<string> = new Set(['or', 'mai', 'sat', 'brx', 'doi', 'ks', 'kok', 'mni']);

/** Whether Taalcut can write out speech in `language` (the clip page's line when it can't). */
export const canWriteOut = (language: string): boolean => !UNWRITTEN.has(language.split('-')[0] ?? language);

/** The language as a native select, with what choosing it does, in the popover Change opens. */
function LanguagePicker({ detail, onDone }: { detail: AssetDetail; onDone: (said: string) => void }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const { run, pending } = useCommand({ toast: false });
  const stored = useRpcQuery((signal) => backend.speech.spokenLanguages(undefined, { signal }), [backend]);
  const locale = useLocaleState();
  const selectId = useId();
  const noteId = useId();
  const speech = detail.asset.speech;
  const chosen = speech?.state === 'chosen';
  const [value, setValue] = useState<string>(detail.asset.language ?? '');
  const [error, setError] = useState<Parameters<typeof ErrorLine>[0]['error'] | null>(null);
  const [resetting, setResetting] = useState(false);
  const yours = spokenLanguagesOrDefault(stored.data?.languages ?? null, locale.data?.resolved ?? 'en');
  const collator = useMemo(() => new Intl.Collator(i18n.locale), [i18n.locale]);
  const others = useMemo(
    () =>
      SPOKEN_LANGUAGE_CHOICES.filter((tag) => !yours.includes(tag))
        .map((tag) => ({ tag, name: formatLanguage(i18n, tag) }))
        .sort((a, b) => collator.compare(a.name, b.name)),
    [yours, i18n, collator],
  );
  const name = value ? formatLanguage(i18n, value) : '';

  const set = async (language: SpokenLanguage | null) => {
    setError(null);
    const result = await run({
      name: LIBRARY_COMMANDS.setAssetLanguage,
      payload: { assetId: detail.asset.id, language },
    });
    if (!result.ok) return setError(result.error);
    const now = language ? formatLanguage(i18n, language) : null;
    onDone(now ? t`This clip is now in ${now}.` : t`Taalcut listens again.`);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value) void set(value);
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={submit} aria-busy={pending || undefined}>
      <label htmlFor={selectId} className="type-label-sm text-ink">
        {t`Language spoken in this clip`}
      </label>
      <Select
        id={selectId}
        value={value}
        aria-describedby={noteId}
        disabled={pending}
        onChange={(event) => setValue(event.target.value)}
      >
        {value === '' ? <option value="">{t`Choose a language`}</option> : null}
        <optgroup label={t`Languages you speak`}>
          {yours.map((tag) => (
            <option key={tag} value={tag}>
              {formatLanguage(i18n, tag)}
            </option>
          ))}
        </optgroup>
        <optgroup label={t`Other languages`}>
          {others.map(({ tag, name: other }) => (
            <option key={tag} value={tag}>
              {other}
            </option>
          ))}
        </optgroup>
      </Select>
      <p id={noteId} className="m-0 type-caption text-ink-2">
        {!value
          ? t`Taalcut files the clip under it, and writes out its speech again in it.`
          : canWriteOut(value)
            ? t`Taalcut files the clip under ${name}, and writes out its speech again in ${name}.`
            : t`Taalcut files the clip under ${name}. It can’t write out ${name} speech yet.`}
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {chosen ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-action="language-reset"
            loading={pending && resetting}
            disabled={pending}
            onClick={() => {
              setResetting(true);
              void set(null).finally(() => setResetting(false));
            }}
          >
            {t`Use what Taalcut heard`}
          </Button>
        ) : null}
        <Button
          type="submit"
          size="sm"
          variant="primary"
          data-action="language-set"
          loading={pending && !resetting}
          disabled={!value || pending || (chosen && value === detail.asset.language)}
        >
          {value ? t`Use ${name}` : t`Use it`}
        </Button>
      </div>
      {error ? <ErrorLine error={error} /> : null}
    </form>
  );
}

/** Sound's first row when someone speaks (LIB1-LANG). */
export function ClipLanguage({ detail, codec }: { detail: AssetDetail; codec: string | null }) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState('');
  const speech = detail.asset.speech;
  const heard = speech && speech.state !== 'chosen';
  // What is spoken: the language, two or three of them, unclear, or just speech.
  const languages = speech ? speech.languages : detail.asset.language ? [detail.asset.language] : [];
  const names = listOf(
    i18n,
    languages.map((tag) => formatLanguage(i18n, tag)),
  );
  const checking = !speech && detail.asset.languagePending === true;
  const words =
    speech?.state === 'unclear'
      ? t`Speech, language unclear`
      : checking
        ? t`Speech, checking the language`
        : languages.length === 0
          ? t`Speech`
          : t`${names} speech`;
  return (
    <Fact
      data-slot="clip-language"
      data-state={speech?.state ?? (checking ? 'checking' : 'heard')}
      leading={
        <Lead>
          <AudioLines aria-hidden className="size-4 text-teal-strong" />
        </Lead>
      }
      title={
        <span className="inline-flex items-center gap-1.5">
          {heard ? <AiMark className="size-3 shrink-0" label={t`Heard by Taalcut`} /> : null}
          <span>{words}</span>
        </span>
      }
      meta={codec ? <span translate="no">{codec}</span> : undefined}
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
        {speech?.state === 'chosen' ? <Chip tone="you">{t`Set by you`}</Chip> : null}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              icon={VERB_ICONS.edit}
              className="-ms-3"
              data-action="change-language"
              aria-label={t`Change the language`}
            >
              {t`Change`}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" aria-label={t`Language spoken in this clip`}>
            <LanguagePicker
              detail={detail}
              onDone={(words) => {
                setSaid(words);
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </span>
      <span aria-live="polite" className="sr-only">
        {said}
      </span>
    </Fact>
  );
}
