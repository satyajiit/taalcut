// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the listening band · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the only time the Mac listens on the network, so it is said first, above every phone tab: the Wi-Fi glyph, the
 *   address, "only while this page is open" and when it stops, with Stop listening; stopped, the reason, its fix and
 *   the screen's one primary (Start again or Try again)
 * states: off (nothing listens until the Wi-Fi tab shows: says so, Show the code) · starting (boneyard bones in the
 *   band's shape, "Getting ready" for screen readers) · listening · stopped
 *   (by you, idle, no Wi-Fi, replaced, port taken, imports drive offline) · failed (the cause, Try again) ·
 *   actions are Buttons (eight states)
 * motion: none of its own; the bones' pulse (tc-bone) until the session arrives
 */
import { useLingui } from '@lingui/react/macro';
import { Button, errorMessage, Skeleton, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Wifi, WifiOff } from 'lucide-react';
import type { TransferSession } from '@taalcut/core';
import type { ReactNode } from 'react';
import { PHONE_TAB_PATHS } from '../flow/phone-tabs';
import { connectionOf, type Connection } from '../session/connection';
import { FIXTURE_SESSION } from '../session/fixtures';
import type { TransferSessionApi } from '../use-transfer-session';
import { stoppedWords } from './stopped-words';

const on = (state: Connection['kind']): boolean =>
  state !== 'off' && state !== 'stopped' && state !== 'failed';

function Band({
  state,
  title,
  detail,
  action,
}: {
  state: Connection['kind'];
  title: ReactNode;
  detail: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div data-slot="listening" data-state={state} className="flex flex-wrap items-center gap-x-4 gap-y-3">
      {on(state) ? (
        <Wifi aria-hidden className="size-5 shrink-0 text-ink" />
      ) : (
        <WifiOff aria-hidden className="size-5 shrink-0 text-ink-3" />
      )}
      <div role="status" className="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-0.5">
        <p className="m-0 type-card-title text-ink">{title}</p>
        <p className="m-0 max-w-prose type-body text-ink-2">{detail}</p>
      </div>
      {action}
    </div>
  );
}

/** `session` null: the fixture's shape, for the bones; `onStop` absent there too. */
function Listening({
  state,
  session: live,
  onStop,
}: {
  state: Connection['kind'];
  session: TransferSession | null;
  onStop?: () => void;
}) {
  const { t, i18n } = useLingui();
  const session = live ?? FIXTURE_SESSION;
  const address = session.network?.address ?? '';
  const stopsAt = session.idleStopAt ? i18n.date(new Date(session.idleStopAt), { timeStyle: 'short' }) : null;
  return (
    <Band
      state={state}
      title={
        <>
          {t`Your Mac is listening on Wi-Fi at`}{' '}
          <span translate="no" className="tabular-nums">
            {address}
          </span>
        </>
      }
      detail={
        stopsAt
          ? t`Reception stays on until you stop listening. It stops at ${stopsAt} if nothing arrives.`
          : t`Reception stays on until you stop listening or close Taalcut.`
      }
      action={
        <Button size="sm" icon={VERB_ICONS.stop} onClick={onStop}>
          {t`Stop listening`}
        </Button>
      }
    />
  );
}

/** The band for the session's state; starting is the listening band's layout, inert, for the bones to cover. */
function BandFor({ transfer, connection }: { transfer: TransferSessionApi; connection: Connection }) {
  const { t, i18n } = useLingui();
  switch (connection.kind) {
    case 'off':
      return (
        <Band
          state="off"
          title={t`Not listening on Wi-Fi`}
          detail={t`Nothing on this Mac listens on the network until you show the Wi-Fi code.`}
          action={
            <Button asChild size="sm">
              <Link to={PHONE_TAB_PATHS.wifi} replace>
                {t`Show the code`}
              </Link>
            </Button>
          }
        />
      );
    case 'starting':
      return (
        <div inert>
          <Listening state="starting" session={null} />
        </div>
      );
    case 'failed':
      return (
        <Band
          state="failed"
          // Failed after it listened (the lan process went away for good) or before it could.
          title={transfer.session ? t`Taalcut stopped listening` : t`Taalcut couldn’t start listening`}
          detail={errorMessage(i18n, connection.error)}
          action={
            <Button variant="primary" icon={VERB_ICONS.retry} onClick={transfer.restart}>
              {t`Try again`}
            </Button>
          }
        />
      );
    case 'stopped': {
      const words = stoppedWords(connection.reason);
      return (
        <Band
          state="stopped"
          title={i18n._(words.title)}
          detail={i18n._(words.next)}
          action={
            <Button variant="primary" onClick={transfer.restart}>
              {i18n._(words.action)}
            </Button>
          }
        />
      );
    }
    default:
      return (
        <Listening state={connection.kind} session={transfer.session} onStop={() => void transfer.stop()} />
      );
  }
}

/**
 * The Wi-Fi session's state, first on every phone screen. Always inside its Skeleton (bones only while it
 * starts), so the capture finds it whatever the session is doing.
 */
export function StatusBand({ transfer }: { transfer: TransferSessionApi }) {
  const { t } = useLingui();
  const connection = connectionOf(transfer);
  const starting = connection.kind === 'starting';
  return (
    <div className="flex flex-col">
      {starting ? (
        <p role="status" className="sr-only">
          {t`Getting ready to listen on Wi-Fi…`}
        </p>
      ) : null}
      <Skeleton
        name="phone-status"
        loading={starting}
        fixture={<Listening state="starting" session={null} />}
      >
        <BandFor transfer={transfer} connection={connection} />
      </Skeleton>
    </div>
  );
}
