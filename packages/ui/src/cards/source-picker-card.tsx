// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: sourcePicker card · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a step panel on the sunken bed; sources are hairline rows, not cards
 * states: default (rows + Add folder, Connect phone) · hover/focus/active (the Buttons') · disabled (an add in flight)
 *   · loading (Add folder spins while the dialog and the command run) · error (the cause in one line under the
 *   actions, the rows stay) · success ("Added Trip": success icon and words; the import card follows)
 *   · empty (no sources yet: Add folder is the screen's primary) · offline source (its row says so)
 * P3-B4, P3-B5: with the app's phone panel, "From my phone" opens Wi-Fi or a cable (phone-choice.tsx); without it,
 *   Connect phone opens the Wi-Fi page as before
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { CardOf, SourceView, TaalcutError } from '@taalcut/core';
import { CircleCheck, Folder, HardDrive, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { usePlatformFeatures } from '../platform/platform-features';
import { useCardActions } from './card-actions';
import { useCardData } from './card-data';
import { UserContent } from './card-frame';
import { PhoneWay } from './phone-choice';
import { ErrorLine } from './error-line';
import { usePrimaryVariant } from './primary-holder';
import { VERB_ICONS } from '../icons/concepts';

function SourceRow({ source }: { source: SourceView }) {
  const { t } = useLingui();
  const Icon = source.kind === 'wifi_import' ? Smartphone : source.status === 'offline' ? HardDrive : Folder;
  const status =
    source.status === 'offline'
      ? t`Offline`
      : source.status === 'missing'
        ? t`Can’t find the folder`
        : source.scan.state === 'scanning'
          ? t`Looking for clips`
          : source.watch
            ? t`Watching for new clips`
            : t`Added`;
  return (
    <li className="flex items-center gap-3 border-b border-rule-subtle py-2 last:border-b-0">
      <Icon aria-hidden className="size-4 shrink-0 text-ink-3" />
      <UserContent translate="no" className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
        {source.name}
      </UserContent>
      <span className="shrink-0 text-xs text-ink-2 tabular-nums">
        <Plural value={source.assets} one="# clip" other="# clips" />
      </span>
      <span
        className={cn(
          'shrink-0 text-xs',
          source.status === 'online' ? 'text-ink-3' : 'font-medium text-warning-strong',
        )}
      >
        {status}
      </span>
      <span className="sr-only">{source.kind === 'wifi_import' ? t`Phone` : t`Folder`}</span>
    </li>
  );
}

/** With no sources yet: where footage can come from. With the app's phone panel, a phone is Wi-Fi or a cable (P3-B4). */
function EmptyLine({ phone }: { phone: boolean }) {
  const { t } = useLingui();
  const { phonePanel } = useCardData();
  const { cableImport } = usePlatformFeatures();
  return phone && phonePanel && cableImport
    ? t`Add a folder on this Mac or a drive, or bring in clips from your phone over Wi-Fi or a cable.`
    : t`Add a folder on this Mac or a drive, or send clips from your phone over Wi-Fi.`;
}

export function SourcePickerCard({ card }: { card: CardOf<'sourcePicker'> }) {
  const { t } = useLingui();
  const actions = useCardActions();
  const primary = usePrimaryVariant(card.id);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const canAdd = card.offers.includes('folder') && actions.pickFolder && actions.dispatch;

  const addFolder = async () => {
    if (!actions.pickFolder || !actions.dispatch) return;
    setAdding(true);
    setError(null);
    const picked = await actions.pickFolder();
    if (!picked.ok) {
      setAdding(false);
      setError(picked.error);
      return;
    }
    if (!picked.value) {
      setAdding(false);
      return;
    }
    const result = await actions.dispatch('library.addSource', { path: picked.value.path });
    setAdding(false);
    if (!result.ok) return setError(result.error);
    setAdded(picked.value.path.split('/').filter(Boolean).pop() ?? picked.value.path);
  };

  const empty = card.sources.length === 0;
  const phone = card.offers.includes('phone');
  return (
    <article
      data-slot="smart-card"
      data-card-type="sourcePicker"
      aria-label={t`Where your footage is`}
      className="flex max-w-[42rem] flex-col gap-3 rounded-xl bg-panel p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-lg font-semibold text-ink">
          {empty ? t`Where is your footage?` : t`Your footage`}
        </h3>
        <p className="m-0 text-sm text-ink-2">
          {empty ? (
            <EmptyLine phone={phone} />
          ) : (
            t`Taalcut looks through these. Add another folder or your phone any time.`
          )}
        </p>
      </div>
      {empty ? null : (
        <ul aria-label={t`Sources`} className="m-0 list-none p-0">
          {card.sources.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {canAdd ? (
          <Button
            variant={empty ? primary : 'secondary'}
            size="sm"
            icon={VERB_ICONS.addFolder}
            loading={adding}
            onClick={() => void addFolder()}
          >
            {t`Add folder`}
          </Button>
        ) : null}
        {phone ? <PhoneWay disabled={adding} /> : null}
        {added || card.status === 'added' ? (
          <p role="status" className="m-0 flex items-center gap-1.5 text-sm text-success-strong">
            <CircleCheck aria-hidden className="size-4 shrink-0" />
            {added ? (
              <Trans>
                Added <UserContent translate="no">{added}</UserContent>
              </Trans>
            ) : (
              t`Added`
            )}
          </p>
        ) : null}
      </div>
      {error ? <ErrorLine error={error} /> : null}
    </article>
  );
}
