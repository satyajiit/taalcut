// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: Send feedback · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a dialog: what happened (the error it came from, if any), the words, Attach a debug bundle (off) and Include what I
 *   typed (off, only with a bundle) as switch rows, the bundle's preview, then Save bundle…, Cancel and Send
 * states: default · empty (Send says why) · sending (Send spins) · sent ("Sent. Thank you.", Close) · failed (the
 *   cause above the buttons, the words kept) · Local only (Send off and says why; Save bundle stays) · saved (one line) */

import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc, type DebugCollectOptions, type TaalcutError } from '@taalcut/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorLine,
  cn,
} from '@taalcut/ui';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';
import { describeError } from '../settings/model-messages';
import { SwitchRow } from '../settings/switch-row';
import { BundlePreview } from './bundle-preview';
import { closeFeedback, useFeedbackState } from './feedback-state';

/** One opening of the dialog: its own words and switches, so opening it again starts clean. */
function FeedbackForm({ error }: { error: TaalcutError | null }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const field = useId();
  const help = useId();
  const privacy = useRpcQuery((signal) => backend.privacy.overview(undefined, { signal }), [backend]);
  const localOnly = privacy.data?.localOnly === true;
  const [message, setMessage] = useState('');
  const [bundle, setBundle] = useState(false);
  const [chatText, setChatText] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState<'send' | 'save' | null>(null);
  const [failed, setFailed] = useState<TaalcutError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const about = error ? describeError(i18n, error) : null;
  const options = useMemo<DebugCollectOptions>(
    () => ({ includeChatText: bundle && chatText }),
    [bundle, chatText],
  );

  const send = async () => {
    const words = message.trim();
    if (!words) return setEmpty(true);
    setBusy('send');
    setFailed(null);
    // "Report this": the error's code goes with the words, so the report and the bundle's logs meet.
    const text = error ? `${words}\n\n[${error.code}]` : words;
    const result = await callRpc(backend.feedback.send({ message: text, bundle: bundle ? options : null }));
    setBusy(null);
    if (!result.ok) return setFailed(result.error);
    void callRpc(
      backend.telemetry.record({
        event: { name: 'feedback.sent', withBundle: bundle, withChatText: bundle && chatText },
      }),
    );
    setSent(true);
  };
  const save = async () => {
    setBusy('save');
    setFailed(null);
    const result = await callRpc(backend.feedback.saveBundle(options));
    setBusy(null);
    if (!result.ok) return setFailed(result.error);
    if (result.value.saved) setSaved(result.value.fileName ?? t`the bundle`);
  };

  if (sent)
    return (
      <>
        <p role="status" className="m-0 flex items-center gap-2 text-base text-ink">
          <CircleCheck aria-hidden className="size-4 shrink-0 text-success-strong" />
          <Trans>Sent. Thank you.</Trans>
        </p>
        <DialogFooter>
          <Button variant="primary" onClick={closeFeedback}>
            <Trans>Done</Trans>
          </Button>
        </DialogFooter>
      </>
    );

  return (
    <>
      <div className="scrollbar-thin -mx-6 flex min-h-0 flex-col gap-4 overflow-y-auto px-6">
        {error ? (
          <p className="m-0 flex items-start gap-2 text-sm text-ink-2">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-strong" />
            <span>
              <Trans>About: {about}</Trans>
            </span>
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field} className="text-sm font-medium text-ink">
            <Trans>What happened, or what would you change?</Trans>
          </label>
          <textarea
            id={field}
            rows={5}
            value={message}
            aria-invalid={empty || undefined}
            aria-describedby={empty ? help : undefined}
            onChange={(event) => {
              setMessage(event.target.value);
              if (empty) setEmpty(false);
            }}
            className={cn(
              'w-full resize-y rounded-md border border-rule-strong bg-canvas px-3 py-2 text-base text-ink',
              'placeholder:text-ink-3 hover:border-ink-3 aria-invalid:border-danger-strong',
            )}
          />
          {empty ? (
            <p id={help} role="alert" className="m-0 text-sm text-danger-strong">
              {t`Write a few words first: what you did, and what happened.`}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col">
          <SwitchRow
            data-setting="bundle"
            label={<Trans>Attach a debug bundle</Trans>}
            description={
              <Trans>Logs and the agent’s recent steps, so the team can see what went wrong.</Trans>
            }
            checked={bundle}
            onChange={setBundle}
          />
          {bundle ? (
            <SwitchRow
              data-setting="chat-text"
              label={<Trans>Include what I typed and Taalcut’s replies</Trans>}
              description={<Trans>Off: only how long each message was.</Trans>}
              checked={chatText}
              onChange={setChatText}
            />
          ) : null}
        </div>
        {bundle || localOnly ? <BundlePreview options={options} /> : null}
        {saved ? (
          <p role="status" className="m-0 text-sm text-ink-2">
            <Trans>
              Saved as <span translate="no">{saved}</span>.
            </Trans>
          </p>
        ) : null}
        {localOnly ? (
          <p className="m-0 text-sm text-ink-2">
            <Trans>Local only is on. Save the bundle and send it yourself.</Trans>
          </p>
        ) : null}
        {failed ? <ErrorLine error={failed} /> : null}
      </div>
      <DialogFooter>
        {bundle || localOnly ? (
          <Button
            variant="ghost"
            className="sm:me-auto"
            loading={busy === 'save'}
            disabled={busy === 'send'}
            onClick={() => void save()}
          >
            <Trans>Save bundle…</Trans>
          </Button>
        ) : null}
        <Button variant="ghost" disabled={busy !== null} onClick={closeFeedback}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="primary"
          loading={busy === 'send'}
          disabled={localOnly || busy === 'save'}
          onClick={() => void send()}
        >
          <Trans>Send</Trans>
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Send feedback (P2-X7): opened from ⌘K, Help → Send feedback (the
 * `help.feedback` UI command) and an error's "Report this". Mounted once, by
 * the root.
 */
export function FeedbackDialog() {
  const state = useFeedbackState();
  return (
    <Dialog open={state.open} onOpenChange={(open) => (open ? undefined : closeFeedback())}>
      <DialogContent data-slot="feedback-dialog" className="flex max-h-[85vh] max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle>
            <Trans>Send feedback</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>The people making Taalcut read every note. Say it the way you’d tell a friend.</Trans>
          </DialogDescription>
        </DialogHeader>
        <FeedbackForm key={state.opened} error={state.error} />
      </DialogContent>
    </Dialog>
  );
}
