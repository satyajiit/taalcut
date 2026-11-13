// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a template's overview (/templates/$templateId; UX4 tpl, REF1) · system:
 *   DESIGN.md v0.7 (KaatuMoment; design-tpl.md)
 * the page's one job is to decide and go: Make a video with this leads (the screen's one marigold: a chat that
 *   makes a video from it starts at once), with how ready it is beside it (slots still to check, and the way to
 *   Slots; or every slot approved). Where it came from in one line led by its format's kind chip, and under it the
 *   reel it keeps (REF1: its video and music kept on this Mac, or the way to get them: reel-media.tsx). Then the slot strip
 *   on the reel's waveform (the product's own picture, research §5): pick or point at a slot to light its stretch of
 *   sound, and the line under it names that slot with the way to check it in Slots. The first time you open a
 *   template Taalcut has just read from a reel, Kaatu says so (a success moment, once)
 * states: latest · older version (the frame's line; no primary: an older version can't be used) · all approved ·
 *   slots to check · just read (the moment) · reel kept or not (reel-media.tsx's) · loading (the "template-detail"
 *   bones)
 * motion: the moment's Kaatu; the strip's selection lights the waveform (colour)
 */
import { plural } from '@lingui/core/macro';
import { Plural, useLingui } from '@lingui/react/macro';
import type { Template } from '@taalcut/core';
import { Button, FormatChip, KaatuMoment, RhythmBed, ROLE_LABELS, toSeconds, UserContent } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { CircleCheck, CircleDashed } from 'lucide-react';
import { useState } from 'react';
import { formatSeconds } from '../../shared/format';
import { templateName } from '../library/library-words';
import { useStartActions } from '../start/use-start';
import { TEMPLATE_ICONS } from '../template-icons';
import { PLATFORM_LABELS } from '../template-words';
import type { TemplateView } from './template-context';
import { useJustRead } from './just-read';
import { ReelMedia } from './reel-media';

/** The selected slot in one line: its number, its role when it has one, what it shows. */
function SlotLine({ template, index }: { template: Template; index: number }) {
  const { t, i18n } = useLingui();
  const slot = template.slots[index];
  if (!slot) return null;
  const number = i18n.number(index + 1);
  const role = slot.role === 'body' ? null : i18n._(ROLE_LABELS[slot.role]);
  const length = formatSeconds(i18n, toSeconds(slot.duration));
  return (
    <p
      className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 type-body text-ink-2"
      data-slot="overview-slot"
    >
      <span className="font-medium text-ink">{role ? t`Slot ${number}, ${role}` : t`Slot ${number}`}</span>
      <span className="tabular-nums">{length}</span>
      {slot.intent.text ? (
        <UserContent translate="no" className="min-w-0 text-ink">
          {slot.intent.text}
        </UserContent>
      ) : null}
    </p>
  );
}

export function TemplateOverview({ view }: { view: TemplateView }) {
  const { t, i18n } = useLingui();
  const { summary, template, latest } = view;
  const actions = useStartActions();
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const justRead = useJustRead(template, summary);
  const toCheck = template.slots.filter((slot) => !slot.approved).length;
  const origin = template.origin;
  const from =
    origin.kind === 'reference' && origin.platform ? i18n._(PLATFORM_LABELS[origin.platform]) : null;
  const name = templateName(i18n, summary);
  const slotsLink = { templateId: template.id };
  const version = latest ? undefined : template.version;

  return (
    <div className="flex flex-col gap-6" data-slot="template-overview">
      {latest ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Button
            variant="primary"
            icon={TEMPLATE_ICONS.makeVideo}
            onClick={() => actions.makeVideo(template.id, name)}
            data-slot="make-video"
          >
            {t`Make a video with this`}
          </Button>
          {toCheck > 0 ? (
            <span
              data-slot="slots-to-check"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 type-body"
            >
              <span className="flex items-center gap-1.5 text-ink">
                <CircleDashed aria-hidden className="size-4 text-warning-strong" />
                <Plural value={toCheck} one="# slot not approved" other="# slots not approved" />
              </span>
              <Button asChild size="sm" variant="ghost" icon={TEMPLATE_ICONS.slots}>
                <Link to="/templates/$templateId/slots" params={slotsLink} search={{ version }}>
                  {t`Check the slots`}
                </Link>
              </Button>
            </span>
          ) : (
            <span data-slot="slots-approved" className="flex items-center gap-1.5 type-body text-ink-2">
              <CircleCheck aria-hidden className="size-4 text-success-strong" />
              {t`Every slot approved`}
            </span>
          )}
        </div>
      ) : null}
      {justRead.shown ? (
        <KaatuMoment tone="success" onDismiss={justRead.dismiss} dismissLabel={t`Dismiss`}>
          {t`Read from the reel: ${plural(template.slots.length, { one: '# slot', other: '# slots' })} on its music beats. Make a video now, or check the slots first.`}
        </KaatuMoment>
      ) : null}
      <div className="flex flex-col gap-2">
        <p className="m-0 flex max-w-prose flex-wrap items-center gap-x-2 gap-y-1 type-body text-ink-2">
          {summary.formatId ? <FormatChip formatId={summary.formatId} /> : null}
          <span>{from ? t`Read from a reel on ${from}.` : t`Made by Taalcut.`}</span>
        </p>
        <ReelMedia summary={summary} template={template} />
      </div>
      <section aria-label={t`Slots on the reel’s sound`} className="flex flex-col gap-3">
        <RhythmBed
          template={template}
          selected={selected}
          onSelect={setSelected}
          hovered={hovered}
          onHover={setHovered}
        />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <SlotLine template={template} index={hovered ?? selected} />
          <Button asChild size="sm" variant="ghost" icon={TEMPLATE_ICONS.open} iconPlacement="end">
            <Link
              to="/templates/$templateId/slots"
              params={slotsLink}
              search={{ version, slot: selected + 1 }}
            >
              {t`Open in Slots`}
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
