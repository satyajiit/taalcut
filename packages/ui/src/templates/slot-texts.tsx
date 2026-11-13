// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the text in a slot (BRK1-REV) · system: DESIGN.md v0.7
 * each line of on-screen text the breakdown read in the slot, as written (OCR: untrusted, never translated): when
 *   it shows, its part (title, label…), the look it has in the reel when gfx read one (its kind's name and a swatch
 *   of its colours, BRK1 §3), and Not text, for a sign or a shirt OCR took for an overlay. Text Taalcut doubts says
 *   so, with It's text beside Not text, and says a made video leaves it out until then (assembly does, BRK1-GFX).
 *   Pointing at or focusing a row draws its box on the reel. DSG1-READ: under a line, how Taalcut read it as a
 *   graphic (graphic-brief.tsx), with Edit the brief and Not a graphic; a line read as footage shows as removed, with
 *   Restore in place of Not text
 * states: default · lit (the row under the pointer or focus: the hover surface; its box on the reel) · doubted (the
 *   dashed warning circle and the doubt's words) · removing (Not text spins) · read-only (no buttons)
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { GraphicBriefPatch, Id, OverlayDesignKind, Template } from '@taalcut/core';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { HOVER_EASE } from '#lib/motion-classes';
import { UserContent } from '../cards/card-frame';
import { GraphicBriefView } from './graphic-brief';
import { briefOf } from './graphic-words';
import { DOUBT_WORDS } from './review-checks';
import { REVIEW_ICONS } from './review-icons';
import { toSeconds } from './slot-words';

type TextId = Id<'TextOverlay'>;

const ROLE_WORDS: Readonly<Record<Template['text'][number]['role'], MessageDescriptor>> = {
  title: msg`Title`,
  label: msg`Label`,
  list: msg`List`,
  caption: msg`Caption`,
  cta: msg`Call to action`,
  other: msg`Text`,
};

/** Each overlay look's name (BRK1 §3), as the review names it. */
export const OVERLAY_KIND_WORDS: Readonly<Record<OverlayDesignKind, MessageDescriptor>> = {
  plain: msg`Plain text`,
  chatBubble: msg`Chat bubble`,
  pill: msg`Pill`,
  label: msg`Label`,
  lowerThird: msg`Lower third`,
  sticker: msg`Sticker`,
  callout: msg`Callout`,
  cta: msg`Button`,
  kineticTitle: msg`Moving title`,
};

export interface SlotTextsProps {
  template: Template;
  slotId: Id<'TemplateSlot'>;
  /** The text item the review is on. */
  current: TextId | null;
  lit: TextId | null;
  onLit: (id: TextId | null) => void;
  /** "Not text"; undefined when read-only. */
  onRemove?: ((id: TextId) => void) | undefined;
  /** "It's text": the doubt dismissed. */
  onKeep?: ((id: TextId) => void) | undefined;
  /** The line whose Not text is on its way. */
  removing: TextId | null;
  /** DSG1-READ: Not a graphic (false) or Restore (true); undefined when read-only. */
  onGraphic?: ((id: TextId, graphic: boolean) => void) | undefined;
  /** DSG1-READ: saves a graphic's brief; resolves true when it was kept. Undefined when read-only. */
  onBrief?: ((id: TextId, patch: GraphicBriefPatch) => Promise<boolean>) | undefined;
  /** The fix on its way, if any (`ReviewEdits.pending`), and the line it is about. */
  pending?: { readonly kind: string; readonly id: TextId | null } | null;
}

export function SlotTexts({
  template,
  slotId,
  current,
  lit,
  onLit,
  onRemove,
  onKeep,
  removing,
  onGraphic,
  onBrief,
  pending = null,
}: SlotTextsProps) {
  const { t, i18n } = useLingui();
  const texts = template.text.filter((item) => item.slotId === slotId);
  const ToCheck = REVIEW_ICONS.toCheck;
  if (texts.length === 0) return null;
  return (
    <ul aria-label={t`Text on screen in this slot`} className="m-0 flex list-none flex-col gap-1 p-0">
      {texts.map((item) => {
        const doubts = item.doubts ?? [];
        const design = item.design ?? null;
        const brief = briefOf(template, item.id);
        const mine = pending?.id === item.id;
        const at = i18n.number(toSeconds(item.start), {
          style: 'unit',
          unit: 'second',
          unitDisplay: 'narrow',
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });
        return (
          <li
            key={item.id}
            data-slot="slot-text"
            data-current={item.id === current || undefined}
            onPointerEnter={() => onLit(item.id)}
            onPointerLeave={() => onLit(null)}
            onFocus={() => onLit(item.id)}
            onBlur={() => onLit(null)}
            className={cn(
              'flex flex-col gap-1 rounded-md px-2 py-1.5',
              HOVER_EASE,
              item.id === lit || item.id === current ? 'bg-hover' : null,
            )}
          >
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="w-10 shrink-0 type-meta text-ink-2 tabular-nums">{at}</span>
              <span className="type-meta text-ink-2">{i18n._(ROLE_WORDS[item.role])}</span>
              <UserContent
                translate="no"
                lang={item.language ?? undefined}
                className="min-w-0 type-label break-words text-ink"
              >
                {item.text}
              </UserContent>
              {design ? (
                <span data-slot="overlay-design" className="flex items-center gap-1.5 type-meta text-ink-2">
                  {/* A sample of the look in the reel's own colours: its fill (the picture's dark when it has none),
                      its outline, its corners, its words' colour. The name beside it says what it is. */}
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex h-4 items-center border px-1 type-caption leading-none font-semibold',
                      design.colors.fill ? null : 'bg-viewer',
                    )}
                    style={{
                      background: design.colors.fill ?? undefined,
                      color: design.colors.text,
                      borderColor: design.colors.stroke ?? 'transparent',
                      borderRadius: `${design.cornerRadius}rem`,
                    }}
                  >
                    {t({
                      message: 'Aa',
                      comment: 'A tiny type sample drawn in an overlay’s colours: two letters',
                    })}
                  </span>
                  {i18n._(OVERLAY_KIND_WORDS[design.kind])}
                </span>
              ) : null}
            </div>
            {doubts.map((doubt) => (
              <p key={doubt.reason} className="m-0 flex items-start gap-1.5 ps-12 type-meta text-ink">
                <ToCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning-strong" />
                <span>
                  {i18n._(DOUBT_WORDS[doubt.reason])}
                  {/* Assembly leaves such a line out while the doubt stands (BRK1-GFX): the answer decides. */}
                  {doubt.reason === 'textMaybeScene' ? (
                    <span className="block text-ink-2">{t`Videos made from this template leave it out until you answer.`}</span>
                  ) : null}
                </span>
              </p>
            ))}
            {brief ? (
              <div className="ps-12">
                <GraphicBriefView
                  brief={brief}
                  onSet={onGraphic ? (graphic) => onGraphic(item.id, graphic) : undefined}
                  onEdit={onBrief ? (patch) => onBrief(item.id, patch) : undefined}
                  setting={mine && pending?.kind === 'setGraphic'}
                  saving={mine && pending?.kind === 'editBrief'}
                  busy={pending !== null}
                />
              </div>
            ) : null}
            {onRemove && brief?.graphic !== false ? (
              <div className="flex flex-wrap gap-2 ps-12">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={REVIEW_ICONS.notText}
                  loading={removing === item.id}
                  disabled={removing !== null && removing !== item.id}
                  onClick={() => onRemove(item.id)}
                >
                  {t`Not text`}
                </Button>
                {doubts.length > 0 && onKeep ? (
                  <Button size="sm" variant="ghost" icon={REVIEW_ICONS.text} onClick={() => onKeep(item.id)}>
                    {t`It’s text`}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
