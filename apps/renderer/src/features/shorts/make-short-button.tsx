// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { callRpc, newId } from '@taalcut/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Segmented,
  errorMessage,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { Scissors, Upload } from 'lucide-react';
import { useId, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { sendWhenOpen } from '../../chat/handoff';
import { shortDuration, shortSourceReference, youtubeSource, type ShortSource } from './short-request';

interface Props {
  source?: Extract<ShortSource, { kind: 'asset' }>;
  disabled?: boolean;
  onCreate?: (text: string) => void;
  localOnly?: boolean;
  primary?: boolean;
}

/** One source, one best short. Progress and the editable result stay in the ordinary chat. */
export function MakeShortButton({ source, disabled, onCreate, localOnly, primary }: Props) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('60');
  const [custom, setCustom] = useState('60');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const duration = shortDuration(choice === 'custom' ? custom : choice);
  const validUrl = localOnly ? null : youtubeSource(url);
  const selected: ShortSource | null =
    source ?? (file ? { kind: 'file', path: file } : validUrl ? { kind: 'url', url: validUrl } : null);
  const chooseFile = async () => {
    setPicking(true);
    setProblem(null);
    try {
      const result = await callRpc(backend.files.pickFile({ purpose: 'reference' }));
      if (!result.ok) setProblem(errorMessage(i18n, result.error));
      else if (result.value) {
        setFile(result.value.path);
        setUrl('');
      }
    } finally {
      setPicking(false);
    }
  };
  const create = () => {
    if (!selected || duration === null) return;
    const reference = shortSourceReference(selected);
    // The number remains unambiguous for the tool even in locales with different digit shapes.
    const seconds = String(duration);
    const text = t`Create one best portrait short for YouTube Shorts and Instagram Reels, with a target of ${seconds} seconds. Find a complete hook, context and payoff in this source, use my channel branding, and prepare the editable video and publishing copy. Source: ${reference}`;
    setOpen(false);
    if (onCreate) onCreate(text);
    else {
      const conversationId = newId<'Conversation'>();
      sendWhenOpen(conversationId, text);
      void navigate({ to: '/chat/$conversationId', params: { conversationId } });
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant={primary ? 'primary' : 'secondary'}
        icon={Scissors}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {t`Make a short`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t`Make a short`}</DialogTitle>
            <DialogDescription>{t`Turn one long video into a portrait story with captions and your branding.`}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            {source ? (
              <p className="m-0 type-body text-ink" translate="no">
                {source.name}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor={`${id}-source`}
                  className="type-label text-ink"
                >{t`YouTube video link`}</label>
                <Input
                  id={`${id}-source`}
                  type="url"
                  value={url}
                  disabled={localOnly || picking}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setFile(null);
                  }}
                  aria-invalid={url.length > 0 && !validUrl}
                />
                {localOnly ? (
                  <p className="m-0 type-meta text-ink-2">{t`Local only is on. Choose a video from this computer.`}</p>
                ) : null}
                {url && !validUrl ? (
                  <p
                    role="alert"
                    className="m-0 type-meta text-danger-strong"
                  >{t`Enter a complete https YouTube video link.`}</p>
                ) : null}
                <Button
                  variant="secondary"
                  icon={Upload}
                  loading={picking}
                  onClick={() => void chooseFile()}
                >{t`Choose a video file…`}</Button>
                {file ? (
                  <p className="m-0 break-all type-meta text-ink-2" translate="no">
                    {file}
                  </p>
                ) : null}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <span className="type-label text-ink">{t`Target length`}</span>
              <Segmented
                label={t`Target length`}
                value={choice}
                onChange={setChoice}
                options={[
                  ...[30, 60, 90].map((value) => ({
                    value: String(value),
                    label: i18n.number(value, { style: 'unit', unit: 'second', unitDisplay: 'short' }),
                  })),
                  { value: 'custom', label: t`Custom` },
                ]}
              />
              {choice === 'custom' ? (
                <>
                  <label
                    htmlFor={`${id}-duration`}
                    className="type-label text-ink"
                  >{t`Length in seconds`}</label>
                  <Input
                    id={`${id}-duration`}
                    type="number"
                    min={15}
                    max={179}
                    step={1}
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    aria-invalid={duration === null}
                  />
                  {duration === null ? (
                    <p
                      role="alert"
                      className="m-0 type-meta text-danger-strong"
                    >{t`Choose a whole number from 15 to 179 seconds.`}</p>
                  ) : null}
                </>
              ) : null}
              <p className="m-0 type-meta text-ink-2">{t`The final cut may be shorter to keep the story complete.`}</p>
            </div>
            {problem ? (
              <p role="alert" className="m-0 type-body text-danger-strong">
                {problem}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t`Cancel`}</Button>
            <Button
              variant="primary"
              disabled={!selected || duration === null || picking}
              onClick={create}
            >{t`Create short`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
