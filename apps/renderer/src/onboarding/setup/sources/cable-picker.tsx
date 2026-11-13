// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, the cable picker · genre: atmospheric studio app · system: DESIGN.md v0.3
 * the onboarding version of the USB picker (docs/onboarding.md 7.3): already filtered to the last 30 days, videos
 *   and Live Photos, only what's new, with one primary button that says what it brings in ("Import 84 clips
 *   (6.2 GB)"). "Choose others…" opens the range and the kinds in place. iCloud Photos on: one calm line.
 * states: loading (the button waits, aria-busy) · default · hover/focus/active (Button, radios, checkboxes) ·
 *   disabled (nothing matches: the line says so) · loading (Import spins) · error (ErrorLine with the fix) ·
 *   success (the run card takes over)
 */
import { plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  callRpc,
  type DeviceFilter,
  type DeviceImportRunId,
  type DeviceView,
  type TaalcutError,
} from '@taalcut/core';
import { Button, ErrorLine } from '@taalcut/ui';
import { CloudOff } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { formatBytes } from '../../../features/shared/format';

const RANGES = [7, 30, 90, null] as const;
type Range = (typeof RANGES)[number];
type Kind = 'video' | 'live' | 'image';
const KINDS: readonly Kind[] = ['video', 'live', 'image'];

/** A local date `days` before today, in ISO form, in this window's time zone. */
function since(days: number, timeZone: string): string {
  const day = new Date(Date.now() - days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(day);
}

/** The onboarding filter: the last 30 days of videos and Live Photos, only what's new, in this window's zone. */
function useCableFilter() {
  const [range, setRange] = useState<Range>(30);
  const [kinds, setKinds] = useState<readonly Kind[]>(['video', 'live']);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const filter: DeviceFilter = useMemo(
    () => ({
      ...(range === null ? {} : { from: since(range, timeZone) }),
      kinds: [...kinds],
      onlyNew: true,
      timeZone,
    }),
    [range, kinds, timeZone],
  );
  const toggle = (kind: Kind) =>
    setKinds((current) => (current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind]));
  return { range, setRange, kinds, toggle, filter };
}

/** The import from the phone, with the filter as it stands. */
function useCableImport(
  deviceKey: string,
  filter: DeviceFilter,
  onStarted: (runId: DeviceImportRunId) => void,
) {
  const backend = useBackend();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const start = async () => {
    setStarting(true);
    setError(null);
    const started = await callRpc(
      backend.transfer.importFromDevice({ deviceKey, selection: { filter, include: [], exclude: [] } }),
    );
    setStarting(false);
    if (!started.ok) return setError(started.error);
    onStarted(started.value.runId);
  };
  return { starting, error, start };
}

interface Choice {
  readonly key: string;
  readonly label: string;
  readonly checked: boolean;
  onChange(): void;
}

/** One group of "Choose others…": radios (one of them) or checkboxes (any of them), each a 24 px row. */
function ChoiceGroup({
  id,
  legend,
  type,
  choices,
}: {
  id: string;
  legend: ReactNode;
  type: 'radio' | 'checkbox';
  choices: readonly Choice[];
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend id={id} className="mb-1 text-sm font-medium text-ink">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {choices.map((choice) => (
          <label key={choice.key} className="flex min-h-6 items-center gap-2 text-sm text-ink">
            <input
              type={type}
              {...(type === 'radio' ? { name: id } : {})}
              checked={choice.checked}
              onChange={choice.onChange}
              className="size-4 accent-primary-strong"
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** "From" (the time the import reaches back) and "Kinds" (videos, Live Photos, photos). */
function OtherChoices({
  ids,
  range,
  onRange,
  kinds,
  onToggle,
}: {
  ids: { range: string; kinds: string };
  range: Range;
  onRange: (range: Range) => void;
  kinds: readonly Kind[];
  onToggle: (kind: Kind) => void;
}) {
  const { t } = useLingui();
  const rangeWords: Record<NonNullable<Range>, string> = {
    7: t`Last 7 days`,
    30: t`Last 30 days`,
    90: t`Last 90 days`,
  };
  const kindWords: Record<Kind, string> = { video: t`Videos`, live: t`Live Photos`, image: t`Photos` };
  return (
    <>
      <ChoiceGroup
        id={ids.range}
        legend={<Trans>From</Trans>}
        type="radio"
        choices={RANGES.map((each) => ({
          key: String(each),
          label: each === null ? t`Everything` : rangeWords[each],
          checked: range === each,
          onChange: () => onRange(each),
        }))}
      />
      <ChoiceGroup
        id={ids.kinds}
        legend={<Trans>Kinds</Trans>}
        type="checkbox"
        choices={KINDS.map((kind) => ({
          key: kind,
          label: kindWords[kind],
          checked: kinds.includes(kind),
          onChange: () => onToggle(kind),
        }))}
      />
    </>
  );
}

/** The one primary button: what it brings in, once counted. */
function ImportButton({
  count,
  bytes,
  ready,
  counting,
  starting,
  onStart,
}: {
  count: number;
  bytes: number;
  ready: boolean;
  counting: boolean;
  starting: boolean;
  onStart: () => void;
}) {
  const { t, i18n } = useLingui();
  const size = formatBytes(i18n, bytes);
  return (
    <Button
      variant="primary"
      data-action="import-recent"
      loading={starting}
      aria-busy={counting || undefined}
      disabled={!ready || count === 0}
      onClick={onStart}
    >
      {ready ? (
        t({
          id: 'onboarding.sources.cable.importRecent',
          message: `Import ${plural(count, { one: '# clip', other: '# clips' })} (${size})`,
        })
      ) : (
        <Trans>Counting what’s new…</Trans>
      )}
    </Button>
  );
}

export function CablePicker({
  device,
  onStarted,
}: {
  device: DeviceView;
  onStarted: (runId: DeviceImportRunId) => void;
}) {
  const { t } = useLingui();
  const backend = useBackend();
  const ids = { range: useId(), kinds: useId() };
  const [others, setOthers] = useState(false);
  const { range, setRange, kinds, toggle, filter } = useCableFilter();
  const { starting, error, start } = useCableImport(device.key, filter, onStarted);
  const summary = useRpcQuery(
    (signal) => backend.transfer.deviceSummary({ deviceKey: device.key, filter }, { signal }),
    [backend, device.key, filter],
  );
  const ready = summary.status === 'ready';
  const count = summary.data?.items ?? 0;
  const usual = range === 30 && kinds.length === 2 && kinds.includes('video') && kinds.includes('live');

  return (
    <div className="flex flex-col items-start gap-3">
      {device.iCloudPhotos ? (
        <p className="m-0 flex max-w-[60ch] items-start gap-2 text-sm text-ink-2">
          <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <Trans>
            iCloud Photos is on, so some videos may be in iCloud rather than on this iPhone. Those import
            later, over Wi-Fi from the phone.
          </Trans>
        </p>
      ) : null}
      <p className="m-0 text-sm text-ink-2">
        {usual
          ? t`The last 30 days of videos and Live Photos, only what’s new.`
          : t`Only what’s new on this phone.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ImportButton
          count={count}
          bytes={summary.data?.bytes ?? 0}
          ready={ready}
          counting={summary.status === 'loading'}
          starting={starting}
          onStart={() => void start()}
        />
        <Button variant="ghost" aria-expanded={others} onClick={() => setOthers((open) => !open)}>
          {t({ id: 'onboarding.sources.cable.chooseOthers', message: 'Choose others…' })}
        </Button>
      </div>
      {ready && count === 0 ? (
        <p role="status" className="m-0 text-sm text-ink-2">
          <Trans>Nothing new matches. Choose a longer time, or other kinds.</Trans>
        </p>
      ) : null}
      {others ? (
        <div className="flex flex-col gap-4 rounded-lg border border-rule-subtle bg-raised p-4">
          <OtherChoices ids={ids} range={range} onRange={setRange} kinds={kinds} onToggle={toggle} />
          {ready ? (
            <p className="m-0 text-sm text-ink-2 tabular-nums">
              <Plural value={count} one="# item matches" other="# items match" />
            </p>
          ) : null}
        </div>
      ) : null}
      {summary.status === 'error' ? <ErrorLine error={summary.error} /> : null}
      {error ? <ErrorLine error={error} /> : null}
    </div>
  );
}
