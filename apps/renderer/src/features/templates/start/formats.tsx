// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Formats (Start from… › Formats, /templates/start/formats; UX4 tpl) · system:
 *   DESIGN.md v0.6 + UX4 (design-tpl.md, "The Start from… card")
 * the formats Taalcut plans itself, as Start from… cards: the preview is the format's own grid on the viewer grey
 *   (a bar line every four music beats at its tempo, across its longest length, the span it runs marked under it:
 *   a format has no slots until Taalcut plans them), its kind mark and name, what it is in a line, its length
 *   range; Use for a video opens a new chat with its ask in the composer, unsent ("Make a vlog from my clips."), so
 *   the person can say which clips first. There is no Copy: a format has no template to copy until the chat plans
 *   one
 * states: loading (bone cards) · filled · error (the cause, Try again) · none with words (nothing: the view's line
 *   says what formats are) · the card's own (start-card.tsx)
 * motion: none of its own (a format's grid doesn't play)
 */
import { useLingui } from '@lingui/react/macro';
import type { FormatSummary } from '@taalcut/core';
import { Button, ErrorLine, Skeleton, VERB_ICONS } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { formatSeconds } from '../../shared/format';
import { openChatWithDraft } from '../chat-draft';
import { KindMark } from '../kind-tile';
import { FORMAT_WORDS } from '../template-words';
import { CardsFixture } from './community-card';
import { CARD_GRID, CardBones, StartCard } from './start-card';

/** A format's grid: a bar line every four beats at its tempo, across its longest length; the span it runs under. */
function FormatGrid({ format }: { format: FormatSummary }) {
  const bars = Math.max(1, Math.floor((format.maxSeconds * format.defaultBpm) / 60 / 4));
  const from = (format.minSeconds / format.maxSeconds) * 100;
  return (
    <span className="flex w-full flex-col gap-2" data-slot="format-grid">
      <span className="relative block h-8">
        {Array.from({ length: bars + 1 }, (_, bar) => (
          <span
            key={bar}
            className="absolute top-0 bottom-0 w-px bg-beat/80"
            style={{ left: `${(bar / bars) * 100}%` }}
          />
        ))}
      </span>
      <span className="relative block h-1 rounded-pill bg-viewer-rule">
        <span
          className="absolute inset-y-0 end-0 rounded-pill bg-viewer-ink-2"
          style={{ insetInlineStart: `${from}%` }}
        />
      </span>
    </span>
  );
}

export function Formats() {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const formats = useRpcQuery((signal) => backend.templates.formats(undefined, { signal }), [backend]);
  if (formats.error && !formats.data)
    return (
      <div className="flex flex-col items-start gap-2">
        <ErrorLine error={formats.error} />
        <Button size="sm" icon={VERB_ICONS.retry} onClick={formats.reload}>
          {t`Try again`}
        </Button>
      </div>
    );
  const known = (formats.data ?? []).flatMap((format) => {
    const words = FORMAT_WORDS[format.id];
    return words ? [{ format, words }] : [];
  });
  return (
    <Skeleton name="start-cards" loading={!formats.data} fallback={<CardBones />} fixture={<CardsFixture />}>
      <ul aria-label={t`Formats`} className={CARD_GRID} data-slot="built-in-formats">
        {known.map(({ format, words }) => {
          const name = i18n._(words.name);
          const min = formatSeconds(i18n, format.minSeconds);
          const max = formatSeconds(i18n, format.maxSeconds);
          return (
            <StartCard
              key={format.id}
              data-format={format.id}
              title={<span data-slot="format-name">{name}</span>}
              name={name}
              mark={<KindMark formatId={format.id} />}
              preview={() => <FormatGrid format={format} />}
              line={i18n._(words.description)}
              facts={t`${min} to ${max}`}
              onUse={() => openChatWithDraft(navigate, i18n._(words.ask))}
            />
          );
        })}
      </ul>
    </Skeleton>
  );
}
