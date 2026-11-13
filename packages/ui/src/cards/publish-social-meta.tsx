// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: publish-social-meta · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.7 · researched social publishing metadata with multi-select inverse checkboxes,
 *   clickable YouTube alternate title chips, per-section copy, and one-click Copy selected ({count}).
 * pre-emit critique: P5 H5 E5 S5 R5 V4 */

import { Trans, useLingui } from '@lingui/react/macro';
import type { SocialMetadataPack } from '@taalcut/core';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '#components/badge';
import { Button } from '#components/button';
import { Checkbox } from '#components/checkbox';
import { cn } from '#lib/cn';
import { VERB_ICONS } from '../icons/concepts';
import { UserContent } from './card-frame';
import { ProductSocialMeta } from './product-social-meta';

export const SOCIAL_SECTIONS = ['ytTitle', 'ytDescription', 'ytTags', 'instagram', 'tiktok'] as const;
export type SocialSectionKey = (typeof SOCIAL_SECTIONS)[number];

export interface PublishSocialMetaProps {
  readonly social: SocialMetadataPack;
  readonly selectedYtTitle: string;
  readonly onSelectYtTitle: (title: string) => void;
  readonly notesTitle?: string;
}

const formatHashtags = (tags: readonly string[]): string =>
  tags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ');

export function formatDescriptionWithChapters(social: SocialMetadataPack): string {
  const base = social.youtube.description.trim();
  if (social.youtube.chapters.length === 0) return base;
  const chapterLines = social.youtube.chapters.map((ch) => `${ch.timecode} ${ch.label}`).join('\n');
  if (base.includes(social.youtube.chapters[0]!.timecode)) return base;
  return `${base}\n\n${chapterLines}`;
}

export function formatInstagramBlock(social: SocialMetadataPack): string {
  const parts = [...new Set([social.instagram.hookLine.trim(), social.instagram.caption.trim()])];
  if (social.instagram.hashtags.length > 0) {
    parts.push(formatHashtags(social.instagram.hashtags));
  }
  return parts.filter(Boolean).join('\n\n');
}

export function formatTikTokBlock(social: SocialMetadataPack, seoPrefix = 'SEO'): string {
  const parts = [social.tiktok.caption.trim()];
  if (social.tiktok.seoKeywords.length > 0) {
    parts.push(`${seoPrefix}: ${social.tiktok.seoKeywords.join(', ')}`);
  }
  if (social.tiktok.hashtags.length > 0) {
    parts.push(formatHashtags(social.tiktok.hashtags));
  }
  return parts.filter(Boolean).join('\n\n');
}

export function PublishSocialMeta({
  social,
  selectedYtTitle,
  onSelectYtTitle,
  notesTitle,
}: PublishSocialMetaProps) {
  const { t, i18n } = useLingui();
  const [selected, setSelected] = useState<ReadonlySet<SocialSectionKey>>(() => new Set(SOCIAL_SECTIONS));
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copyText = async (key: string, text: string) => {
    setCopiedKey(null);
    setCopyFailed(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!navigator.clipboard?.writeText) {
      setCopyFailed(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setCopyFailed(true);
      return;
    }
    setCopiedKey(key);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedKey(null), 2000);
  };

  const toggleSection = (key: SocialSectionKey, next: boolean) => {
    setCopiedKey((prev) => (prev === 'selected' ? null : prev));
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(key);
      else copy.delete(key);
      return copy;
    });
  };

  const allSelected = selected.size === SOCIAL_SECTIONS.length;
  const toggleAll = () => {
    setCopiedKey((prev) => (prev === 'selected' ? null : prev));
    setSelected(allSelected ? new Set() : new Set(SOCIAL_SECTIONS));
  };

  const ytDescriptionText = formatDescriptionWithChapters(social);
  const ytTagsText = social.youtube.tags.join(', ');
  const instagramText = formatInstagramBlock(social);
  const tiktokText = formatTikTokBlock(social, t`SEO`);

  const sectionTextMap: Readonly<
    Record<SocialSectionKey, { readonly heading: string; readonly body: string }>
  > = {
    ytTitle: { heading: t`=== YOUTUBE TITLE ===`, body: selectedYtTitle },
    ytDescription: { heading: t`=== YOUTUBE DESCRIPTION & CHAPTERS ===`, body: ytDescriptionText },
    ytTags: { heading: t`=== YOUTUBE TAGS ===`, body: ytTagsText },
    instagram: { heading: t`=== INSTAGRAM REELS ===`, body: instagramText },
    tiktok: { heading: t`=== TIKTOK ===`, body: tiktokText },
  };

  const copySelected = () => {
    const blocks = SOCIAL_SECTIONS.filter((key) => selected.has(key)).map(
      (key) => `${sectionTextMap[key].heading}\n${sectionTextMap[key].body}`,
    );
    if (blocks.length === 0) return;
    void copyText('selected', blocks.join('\n\n'));
  };

  const allYtTitles = [
    social.youtube.title,
    ...social.youtube.titleAlternates.filter((alt) => alt !== social.youtube.title),
  ];
  const selectedCount = i18n.number(selected.size);

  return (
    <section
      aria-label={t`Social publishing metadata`}
      data-slot="publish-social-meta"
      className="flex flex-col gap-3 border-t border-rule pt-3"
    >
      {copyFailed ? <p role="alert">{t`Could not copy. Select the text and copy it manually.`}</p> : null}
      {/* Research Notes */}
      {social.researchSummary.length > 0 ? (
        <div
          data-slot="research-summary"
          className="flex flex-col gap-1.5 rounded-lg border border-rule-subtle bg-sunken p-2.5"
        >
          <span className="type-meta font-semibold text-ink-2">
            {notesTitle ?? t`Video research insights`}
          </span>
          <ul className="m-0 flex list-disc flex-col gap-0.5 ps-4 type-meta text-ink-2">
            {social.researchSummary.map((note, idx) => (
              <li key={idx}>
                <UserContent translate="no">{note}</UserContent>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Header bar: Multi-select controls + Copy selected */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="type-card-title text-ink">{t`Ready-to-paste copy`}</span>
          <button
            type="button"
            data-slot="select-all-toggle"
            onClick={toggleAll}
            className="cursor-pointer rounded-pill border border-rule bg-control px-2.5 py-0.5 type-caption font-semibold text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-control-hover hover:text-ink"
          >
            {allSelected ? t`Clear` : t`Select all`}
          </button>
        </div>

        <Button
          size="sm"
          variant="primary"
          data-slot="copy-selected-button"
          icon={copiedKey === 'selected' ? Check : VERB_ICONS.copy}
          disabled={selected.size === 0}
          onClick={copySelected}
        >
          {copiedKey === 'selected' ? t`Copied` : t`Copy selected (${selectedCount})`}
        </Button>
      </div>

      {/* 1. YouTube Title + Alternates */}
      <div
        data-slot="social-block-ytTitle"
        className="flex flex-col gap-2 rounded-lg border border-rule bg-sunken p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <Checkbox
            checked={selected.has('ytTitle')}
            onCheckedChange={(next) => toggleSection('ytTitle', next)}
            label={t`YouTube title`}
          />
          <Button
            size="sm"
            variant="ghost"
            data-slot="copy-ytTitle"
            icon={copiedKey === 'ytTitle' ? Check : VERB_ICONS.copy}
            aria-label={t`Copy YouTube title`}
            onClick={() => void copyText('ytTitle', selectedYtTitle)}
          >
            {copiedKey === 'ytTitle' ? t`Copied` : t`Copy`}
          </Button>
        </div>
        <p
          data-slot="active-yt-title"
          className="m-0 rounded-md border border-rule-subtle bg-raised px-2.5 py-1.5 type-label text-ink"
        >
          <UserContent translate="no">{selectedYtTitle}</UserContent>
        </p>
        {allYtTitles.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5" data-slot="yt-title-alternates">
            <span className="type-caption text-ink-3">{t`Alternates:`}</span>
            {allYtTitles.map((title, idx) => {
              const active = title === selectedYtTitle;
              return (
                <button
                  key={idx}
                  type="button"
                  data-slot="yt-title-chip"
                  aria-pressed={active}
                  onClick={() => onSelectYtTitle(title)}
                  className={cn(
                    'cursor-pointer rounded-pill border px-2.5 py-0.5 text-start type-caption transition-colors duration-(--dur-micro) ease-(--ease-out)',
                    active
                      ? 'border-rule-strong bg-inverse text-on-inverse font-semibold'
                      : 'border-rule bg-raised text-ink-2 hover:bg-hover hover:text-ink',
                  )}
                >
                  <UserContent translate="no">{title}</UserContent>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* 2. YouTube Description & Chapters */}
      <div
        data-slot="social-block-ytDescription"
        className="flex flex-col gap-2 rounded-lg border border-rule bg-sunken p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <Checkbox
            checked={selected.has('ytDescription')}
            onCheckedChange={(next) => toggleSection('ytDescription', next)}
            label={t`YouTube description & chapters`}
          />
          <Button
            size="sm"
            variant="ghost"
            data-slot="copy-ytDescription"
            icon={copiedKey === 'ytDescription' ? Check : VERB_ICONS.copy}
            aria-label={t`Copy YouTube description`}
            onClick={() => void copyText('ytDescription', ytDescriptionText)}
          >
            {copiedKey === 'ytDescription' ? t`Copied` : t`Copy`}
          </Button>
        </div>
        <div className="rounded-md border border-rule-subtle bg-raised p-2.5 type-body text-ink">
          <UserContent translate="no">{ytDescriptionText}</UserContent>
        </div>
      </div>

      {/* 3. YouTube Tags (comma-separated) */}
      <div
        data-slot="social-block-ytTags"
        className="flex flex-col gap-2 rounded-lg border border-rule bg-sunken p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <Checkbox
            checked={selected.has('ytTags')}
            onCheckedChange={(next) => toggleSection('ytTags', next)}
            label={t`YouTube tags`}
          />
          <Button
            size="sm"
            variant="ghost"
            data-slot="copy-ytTags"
            icon={copiedKey === 'ytTags' ? Check : VERB_ICONS.copy}
            aria-label={t`Copy YouTube tags`}
            onClick={() => void copyText('ytTags', ytTagsText)}
          >
            {copiedKey === 'ytTags' ? t`Copied` : t`Copy`}
          </Button>
        </div>
        <p className="m-0 rounded-md border border-rule-subtle bg-raised px-2.5 py-1.5 font-mono type-meta text-ink-2">
          <UserContent translate="no">{ytTagsText}</UserContent>
        </p>
      </div>

      {/* 4. Instagram Reels Caption */}
      <div
        data-slot="social-block-instagram"
        className="flex flex-col gap-2 rounded-lg border border-rule bg-sunken p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <Checkbox
            checked={selected.has('instagram')}
            onCheckedChange={(next) => toggleSection('instagram', next)}
            label={t`Instagram Reels caption`}
          />
          <Button
            size="sm"
            variant="ghost"
            data-slot="copy-instagram"
            icon={copiedKey === 'instagram' ? Check : VERB_ICONS.copy}
            aria-label={t`Copy Instagram caption`}
            onClick={() => void copyText('instagram', instagramText)}
          >
            {copiedKey === 'instagram' ? t`Copied` : t`Copy`}
          </Button>
        </div>
        <div className="flex flex-col gap-1 rounded-md border border-rule-subtle bg-raised p-2.5 type-body text-ink">
          <p className="m-0 font-semibold">
            <UserContent translate="no">{social.instagram.hookLine}</UserContent>
          </p>
          <p className="m-0 text-ink-2">
            <UserContent translate="no">{social.instagram.caption}</UserContent>
          </p>
          {social.instagram.hashtags.length > 0 ? (
            <p className="m-0 type-meta text-ink-3">
              <UserContent translate="no">{formatHashtags(social.instagram.hashtags)}</UserContent>
            </p>
          ) : null}
        </div>
      </div>

      {/* 5. TikTok Caption & SEO Keywords */}
      <div
        data-slot="social-block-tiktok"
        className="flex flex-col gap-2 rounded-lg border border-rule bg-sunken p-3"
      >
        <div className="flex items-center justify-between gap-2">
          <Checkbox
            checked={selected.has('tiktok')}
            onCheckedChange={(next) => toggleSection('tiktok', next)}
            label={t`TikTok caption & SEO keywords`}
          />
          <Button
            size="sm"
            variant="ghost"
            data-slot="copy-tiktok"
            icon={copiedKey === 'tiktok' ? Check : VERB_ICONS.copy}
            aria-label={t`Copy TikTok caption`}
            onClick={() => void copyText('tiktok', tiktokText)}
          >
            {copiedKey === 'tiktok' ? t`Copied` : t`Copy`}
          </Button>
        </div>
        <div className="flex flex-col gap-1.5 rounded-md border border-rule-subtle bg-raised p-2.5 type-body text-ink">
          <p className="m-0">
            <UserContent translate="no">{social.tiktok.caption}</UserContent>
          </p>
          {social.tiktok.seoKeywords.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <Badge tone="neutral">
                <Trans>SEO</Trans>
              </Badge>
              <span className="type-meta text-ink-2">
                <UserContent translate="no">{social.tiktok.seoKeywords.join(', ')}</UserContent>
              </span>
            </div>
          ) : null}
          {social.tiktok.hashtags.length > 0 ? (
            <p className="m-0 type-meta text-ink-3">
              <UserContent translate="no">{formatHashtags(social.tiktok.hashtags)}</UserContent>
            </p>
          ) : null}
        </div>
      </div>
      <ProductSocialMeta social={social} copy={copyText} />
    </section>
  );
}
