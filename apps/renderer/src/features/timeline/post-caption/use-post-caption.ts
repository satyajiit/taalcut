// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: the caption panel's state. The caption is the video's (`timeline.postCaptions`, one per platform), so
 * what is saved comes with the timeline and the panel shows it again whenever it opens. The person's text is a
 * draft over it: flagged against the platform's rule as they type, saved by `timeline.setPostCaption` as it is
 * (never refused). "Generate with AI" asks the docked chat, with the platform and the note as data; the panel
 * waits for the caption the run saves. The credit switch is `postCaption.credit`, changed by a person's command.
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  POST_CAPTION_COMMAND,
  POST_CAPTION_NOTE_MAX,
  POST_CAPTION_PLATFORMS,
  POST_CAPTION_SETTING_COMMANDS,
  POST_CAPTION_TEXT_MAX,
  postCaptionIssues,
  withPostCaptionCredit,
  type PostCaptionIssue,
  type PostCaptionPlatform,
  type SavedPostCaption,
  type TaalcutError,
  type Timeline,
} from '@taalcut/core';
import { useEffect, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useCommand } from '../../../backend/use-command';
import { sendInChat, useDockedChat } from '../dock/chat-requests';
import { postCaptionRequestWords } from './post-caption-words';

/** How Taalcut's writing stands, for a caption asked for from this panel. */
export type PostCaptionAsk =
  /** Nothing asked, or the caption asked for has arrived. */
  | 'idle'
  /** The chat has yet to take the request. */
  | 'sending'
  /** The run is going. */
  | 'writing'
  /** The run ended and saved no new caption. */
  | 'unsaved';

export type PostCaptionCopy = 'idle' | 'copied' | 'failed';
const COPIED_MS = 2_500;

export interface PostCaptionState {
  readonly platform: PostCaptionPlatform;
  setPlatform(platform: PostCaptionPlatform): void;
  /** The caption the video keeps for the platform, if any. */
  readonly saved: SavedPostCaption | null;
  /** The text in the box. */
  readonly draft: string;
  setDraft(text: string): void;
  /** The box holds words the video does not keep yet. */
  readonly dirty: boolean;
  /** What the text has outside the platform's rule (none for an empty box). */
  readonly issues: readonly PostCaptionIssue[];
  readonly length: number;
  readonly note: string;
  setNote(note: string): void;
  /** The credit switch: `ready` once the app has said how it stands. */
  readonly credit: { readonly on: boolean; readonly ready: boolean; readonly error: TaalcutError | null };
  setCredit(on: boolean): void;
  readonly ask: PostCaptionAsk;
  /** Taalcut works in the chat on something else, or another request waits there. */
  readonly chatBusy: boolean;
  /** Nothing can be asked or changed now: Taalcut is writing, or the chat is busy. */
  readonly held: boolean;
  generate(): void;
  readonly saving: boolean;
  readonly error: TaalcutError | null;
  /** Saves the box as the video's caption (an empty box removes it). True when the video keeps it. */
  save(): Promise<boolean>;
  readonly copied: PostCaptionCopy;
  copy(): void;
}

const key = (caption: SavedPostCaption | null) => (caption ? `${caption.writtenBy}:${caption.text}` : '');

export function usePostCaption(timeline: Timeline, open: boolean): PostCaptionState {
  const { i18n } = useLingui();
  const backend = useBackend();
  const command = useCommand({ toast: false });
  const chat = useDockedChat();
  const [platform, setPlatform] = useState<PostCaptionPlatform>(POST_CAPTION_PLATFORMS[0]);
  const saved = timeline.postCaptions?.find((caption) => caption.platform === platform) ?? null;
  const savedText = saved?.text ?? '';

  // The draft starts from what is saved, and starts over when that changes (Taalcut's caption, an undo, a save).
  const [base, setBase] = useState(savedText);
  const [draft, setDraftText] = useState(savedText);
  if (base !== savedText) {
    setBase(savedText);
    setDraftText(savedText);
  }
  const text = draft.trim();
  const dirty = text !== savedText;

  const [note, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [copied, setCopied] = useState<PostCaptionCopy>('idle');
  // Each opening starts from what the video keeps (an emptied box left behind is not a caption taken away).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDraftText(savedText);
      setError(null);
      setCopied('idle');
    }
  }
  useEffect(() => {
    if (copied !== 'copied') return;
    const timer = setTimeout(() => setCopied('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // The credit switch, read each time the panel opens.
  const [credit, setCreditState] = useState<PostCaptionState['credit']>({
    on: true,
    ready: false,
    error: null,
  });
  useEffect(() => {
    if (!open) return;
    let live = true;
    void callRpc(backend.postCaption.credit()).then((read) => {
      if (!live) return;
      setCreditState(
        read.ok
          ? { on: read.value.enabled, ready: true, error: null }
          : { on: true, ready: false, error: read.error },
      );
    });
    return () => {
      live = false;
    };
  }, [open, backend]);

  // A caption asked for here: the request's tick in the chat's queue, and the caption the video kept then.
  const [asked, setAsked] = useState<{ readonly tick: number; readonly from: string } | null>(null);
  /** The chat was seen working on the request: when it stops after that, the run is over. */
  const [ran, setRan] = useState(false);
  const sending = asked !== null && chat.waiting === asked.tick;
  const running = asked !== null && !sending && chat.busy;
  useEffect(() => {
    if (running) setRan(true);
  }, [running]);
  const arrived = asked !== null && saved?.writtenBy === 'ai' && key(saved) !== asked.from;
  const ended = asked !== null && !sending && ran && !chat.busy;
  useEffect(() => {
    // The caption came and the run is over: nothing is being asked any more.
    if (arrived && ended) setAsked(null);
  }, [arrived, ended]);
  const ask: PostCaptionAsk =
    asked === null || arrived ? 'idle' : sending ? 'sending' : ended ? 'unsaved' : 'writing';
  // The request made here is still the chat's: waiting there, being written, or its answer being finished.
  const ours = asked !== null && !ended;
  // One request waits in the chat at a time, and a chat that is working takes nothing new.
  const chatBusy = !ours && (chat.busy || chat.waiting > 0);
  const held = ours || chatBusy;

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaving(true);
    setError(null);
    const done = await command.run({
      name: POST_CAPTION_COMMAND,
      payload: { projectId: timeline.projectId, timelineId: timeline.id, platform, text: text || null },
    });
    setSaving(false);
    if (!done.ok) setError(done.error);
    return done.ok;
  };

  return {
    platform,
    setPlatform,
    saved,
    draft,
    setDraft: (next) => setDraftText(next.slice(0, POST_CAPTION_TEXT_MAX)),
    dirty,
    issues: text ? postCaptionIssues(platform, text, { credit: credit.on }) : [],
    length: text.length,
    note,
    setNote: (next) => setNoteText(next.slice(0, POST_CAPTION_NOTE_MAX)),
    credit,
    setCredit(on) {
      if (!credit.ready) return;
      setCreditState({ on, ready: true, error: null });
      // What is in the box follows the switch at once; it is saved with the next save, like any other edit.
      if (text) setDraftText(withPostCaptionCredit(platform, draft, on));
      void command
        .run({ name: POST_CAPTION_SETTING_COMMANDS.setCredit, payload: { enabled: on } })
        .then((done) => {
          if (!done.ok) setCreditState({ on: !on, ready: true, error: done.error });
        });
    },
    ask,
    chatBusy,
    held,
    generate() {
      if (held || saving) return;
      void (async () => {
        // The person's own words go into the video's history first, so undo brings them back.
        if (dirty && !(await save())) return;
        const words = note.trim();
        const request = postCaptionRequestWords(i18n, platform);
        setRan(false);
        setAsked({
          tick: sendInChat({
            text: words ? `${request} ${words}` : request,
            selections: [],
            postCaption: { platform, ...(words ? { note: words } : {}) },
          }),
          // What the video keeps as the request goes: the caption that comes is another.
          from: dirty ? `person:${text}` : key(saved),
        });
      })();
    },
    saving,
    error,
    save,
    copied,
    copy() {
      if (!text) return;
      // The clipboard first, while the click still counts as the person's; then the video keeps what was copied.
      const written = navigator.clipboard?.writeText(text);
      if (!written) setCopied('failed');
      else
        written.then(
          () => setCopied('copied'),
          () => setCopied('failed'),
        );
      void save();
    },
  };
}
