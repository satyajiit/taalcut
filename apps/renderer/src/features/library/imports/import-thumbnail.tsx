// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Film, Image } from 'lucide-react';
import { useEffect, useState } from 'react';

const RETRY_MS = [250, 500, 1000];
/** Native device previews may arrive just after the first item page; retry only a bounded local request. */
function NativeThumbnail({ url }: { url: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const delay = RETRY_MS[attempt];
    if (!failed || delay === undefined || !url.startsWith('app:')) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setAttempt((value) => value + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [failed, attempt, url]);
  let source = url;
  if (attempt && URL.canParse(url)) {
    const retry = new URL(url);
    retry.searchParams.set('previewAttempt', String(attempt));
    source = retry.href;
  }
  return (
    <img
      key={attempt}
      src={source}
      alt=""
      loading="lazy"
      className="absolute inset-0 size-full object-cover transition-opacity duration-(--dur-short)"
      style={{ opacity: loaded ? 1 : 0 }}
      onLoad={() => {
        setLoaded(true);
        setFailed(false);
      }}
      onError={() => setFailed(true)}
    />
  );
}
export function ImportThumbnail({
  url,
  kind = 'video',
}: {
  url: string | null;
  kind?: 'video' | 'image';
}) {
  const Icon = kind === 'image' ? Image : Film;
  return (
    <span className="relative flex h-13 w-18 shrink-0 items-center justify-center overflow-hidden rounded-md border border-rule-subtle bg-sunken">
      <Icon aria-hidden className="size-4 text-ink-3" />
      {url ? <NativeThumbnail key={url} url={url} /> : null}
    </span>
  );
}
