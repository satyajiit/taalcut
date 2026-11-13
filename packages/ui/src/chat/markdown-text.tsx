// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ReactNode } from 'react';
import { cn } from '#lib/cn';

export interface MarkdownTextProps {
  text: string;
  className?: string;
}

const INLINE_TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|(?<!\*)\*[^*\n]+\*(?!\*))/g;

function renderInline(line: string, keyPrefix: string): ReactNode[] {
  const parts = line.split(INLINE_TOKEN);
  return parts.map((part, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded-sm bg-sunken px-1 py-0.5 font-mono text-[0.9em] text-ink">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
      const splitAt = part.indexOf('](');
      const label = part.slice(1, splitAt);
      const href = part.slice(splitAt + 2, -1);
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-rule-strong underline-offset-2 hover:text-ink"
        >
          {label}
        </a>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

/**
 * Clean, safe, dependency-free Markdown renderer for assistant messages,
 * reasoning traces, step summaries, and workspace `.md` previews.
 * Wrapped in `data-user-content` with `translate="no"` so user/model content
 * is never machine-translated and existing `[data-user-content]` selectors work.
 */
export function MarkdownText({ text, className }: MarkdownTextProps) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre
          key={`code-${i}`}
          className="m-0 overflow-x-auto rounded-md bg-well p-3 font-mono text-xs leading-5 text-ink"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const content = renderInline(headingMatch[2]!, `h-${i}`);
      const Tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
      blocks.push(
        <Tag
          key={`h${level}-${i}`}
          className={
            level === 1
              ? 'm-0 text-base font-semibold text-ink'
              : level === 2
                ? 'm-0 text-sm font-semibold text-ink'
                : 'm-0 text-sm font-medium text-ink'
          }
        >
          {content}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`q-${i}`}
          className="m-0 border-s-2 border-rule-strong ps-3 text-ink-2 italic"
        >
          {renderInline(quoteLines.join(' '), `q-${i}`)}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="m-0 flex list-disc flex-col gap-1 ps-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ul-${i}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="m-0 flex list-decimal flex-col gap-1 ps-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ol-${i}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !(lines[i] ?? '').trim().startsWith('```') &&
      !/^(#{1,3}|\d+\.|[-*>])\s/.test((lines[i] ?? '').trim())
    ) {
      paraLines.push(lines[i] ?? '');
      i += 1;
    }
    blocks.push(
      <p key={`p-${i}`} className="m-0 leading-relaxed break-words">
        {renderInline(paraLines.join('\n'), `p-${i}`)}
      </p>,
    );
  }

  return (
    <div
      data-user-content
      translate="no"
      className={cn('flex flex-col gap-2 leading-relaxed break-words', className)}
    >
      {blocks.length > 0 ? blocks : text}
    </div>
  );
}
