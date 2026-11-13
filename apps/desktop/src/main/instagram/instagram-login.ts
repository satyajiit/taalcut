// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's Instagram login window and keychain vault adapter. Opens an isolated
 * Electron `BrowserWindow` on `https://www.instagram.com/accounts/login/`,
 * captures `sessionid`, `csrftoken`, and `ds_user_id` cookies once the user
 * signs in, stores them encrypted in `SecretStore` (`safeStorage`), and wipes
 * the temporary browser partition.
 */
import {
  CancelledError,
  createToken,
  err,
  INSTAGRAM_PROVIDER,
  INSTAGRAM_WARNING,
  ok,
  ValidationError,
  type AcknowledgementStore,
  type AsyncResult,
  type SignInWarning,
} from '@taalcut/core';
import type { AuthBroker, SecretStore } from '@taalcut/models';
import { BrowserWindow, session } from 'electron';
import {
  INSTAGRAM_SECRET_KEY,
  storedInstagramSessionSchema,
  toInstagramWebSession,
  type StoredInstagramSession,
} from '../../shared/instagram-session';

const INSTAGRAM_LOGIN_URL = 'https://www.instagram.com/accounts/login/';
const INSTAGRAM_CURRENT_USER_URL = 'https://www.instagram.com/api/v1/accounts/current_user/?edit=true';
const INSTAGRAM_WEB_APP_ID = '936619743392459';
const LOGIN_PARTITION = 'instagram-login';
const ALLOWED_LOGIN_HOSTS = ['instagram.com', 'facebook.com', 'meta.com'] as const;

export function isAllowedInstagramLoginUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_LOGIN_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export interface InstagramAccountState {
  readonly signedIn: boolean;
  readonly username?: string;
  readonly warning: SignInWarning;
  readonly acknowledgedAt?: number;
}

export interface MainInstagramAuth {
  status(): AsyncResult<InstagramAccountState>;
  signIn(input: { readonly acknowledgedAt?: number }): AsyncResult<void>;
  signOut(): AsyncResult<void>;
  getCredential(): AsyncResult<{
    readonly kind: 'api_key';
    readonly secret: string;
    readonly headers: Record<string, string>;
    readonly source: string;
  } | null>;
}

export const MainInstagramAuthToken = createToken<MainInstagramAuth>('desktop.mainInstagramAuth');

async function resolveInstagramUsername(
  loginSession: Electron.Session,
  csrfToken: string,
): Promise<string | undefined> {
  try {
    const response = await loginSession.fetch(INSTAGRAM_CURRENT_USER_URL, {
      headers: {
        accept: '*/*',
        'x-ig-app-id': INSTAGRAM_WEB_APP_ID,
        'x-csrftoken': csrfToken,
        'x-requested-with': 'XMLHttpRequest',
        referer: 'https://www.instagram.com/',
      },
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { user?: { username?: unknown } };
    return typeof data.user?.username === 'string' && data.user.username.trim()
      ? data.user.username.trim().slice(0, 120)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function openElectronInstagramLoginWindow(): AsyncResult<StoredInstagramSession> {
  const loginSession = session.fromPartition(LOGIN_PARTITION, { cache: false });
  loginSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
  loginSession.setPermissionCheckHandler(() => false);
  await loginSession.clearStorageData().catch(() => undefined);

  const win = new BrowserWindow({
    width: 460,
    height: 700,
    title: 'Sign in to Instagram — Taalcut',
    autoHideMenuBar: true,
    webPreferences: {
      session: loginSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedInstagramLoginUrl(url)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedInstagramLoginUrl(url)) event.preventDefault();
  });

  return new Promise((resolve) => {
    let settled = false;
    let checking = false;
    const finish = async (result: Awaited<AsyncResult<StoredInstagramSession>>) => {
      if (settled) return;
      settled = true;
      loginSession.cookies.removeListener('changed', onCookieChanged);
      if (!win.isDestroyed()) win.destroy();
      await loginSession.clearStorageData().catch(() => undefined);
      resolve(result);
    };

    const checkCookies = async () => {
      if (settled || checking || win.isDestroyed()) return;
      checking = true;
      try {
        const cookies = await loginSession.cookies.get({ domain: 'instagram.com' });
        if (settled || win.isDestroyed()) return;
        const byName = new Map(cookies.map((c) => [c.name, c.value]));
        const sessionId = byName.get('sessionid')?.trim();
        const dsUserId = byName.get('ds_user_id')?.trim();
        const csrfToken = byName.get('csrftoken')?.trim();
        if (!sessionId || !dsUserId || !csrfToken) return;

        const userAgent = win.webContents.getUserAgent();
        const username = await resolveInstagramUsername(loginSession, csrfToken);
        if (settled || win.isDestroyed()) return;
        await finish(
          ok({
            sessionId,
            csrfToken,
            dsUserId,
            ...(username ? { username } : {}),
            ...(userAgent ? { userAgent } : {}),
            createdAt: Date.now(),
          }),
        );
      } catch {
        // Ignore transient cookie read errors while page is still navigating.
      } finally {
        checking = false;
      }
    };

    const onCookieChanged = (
      _event: Electron.Event,
      cookie: Electron.Cookie,
      _cause: string,
      removed: boolean,
    ) => {
      if (
        !removed &&
        (cookie.name === 'sessionid' || cookie.name === 'ds_user_id' || cookie.name === 'csrftoken')
      ) {
        void checkCookies();
      }
    };

    loginSession.cookies.on('changed', onCookieChanged);
    win.webContents.on('did-navigate', () => void checkCookies());
    win.on('closed', () => {
      void finish(err(CancelledError({ reason: 'user' })));
    });

    void win.loadURL(INSTAGRAM_LOGIN_URL);
  });
}

export function createMainInstagramAuth(deps: {
  readonly secrets: Pick<SecretStore, 'get' | 'set' | 'delete'>;
  readonly acknowledgements: AcknowledgementStore;
  readonly openLoginWindow?: () => AsyncResult<StoredInstagramSession>;
  readonly onChange?: () => void;
}): MainInstagramAuth {
  const openWindow = deps.openLoginWindow ?? openElectronInstagramLoginWindow;
  let activeSignIn: AsyncResult<void> | null = null;

  async function readStored(): AsyncResult<StoredInstagramSession | null> {
    const raw = await deps.secrets.get(INSTAGRAM_SECRET_KEY);
    if (!raw.ok) return raw;
    if (!raw.value) return ok(null);
    try {
      const parsed = storedInstagramSessionSchema.safeParse(JSON.parse(raw.value));
      return ok(parsed.success ? parsed.data : null);
    } catch {
      return ok(null);
    }
  }

  async function runSignIn({ acknowledgedAt }: { readonly acknowledgedAt?: number }): AsyncResult<void> {
    if (acknowledgedAt !== undefined) {
      const recorded = await deps.acknowledgements.record({
        featureId: INSTAGRAM_WARNING.feature,
        termsVersion: INSTAGRAM_WARNING.termsVersion,
        at: acknowledgedAt,
      });
      // REF1: signing in records the Instagram warning only; no download warning exists to record.
      if (!recorded.ok) return recorded;
    } else {
      const hasAck = await deps.acknowledgements.has(
        INSTAGRAM_WARNING.feature,
        INSTAGRAM_WARNING.termsVersion,
      );
      if (!hasAck.ok) return hasAck;
      if (!hasAck.value) {
        return err(
          ValidationError({ field: 'acknowledgedAt' }, { detail: 'Instagram warning not acknowledged' }),
        );
      }
    }

    const loggedIn = await openWindow();
    if (!loggedIn.ok) return loggedIn;

    const saved = await deps.secrets.set(INSTAGRAM_SECRET_KEY, JSON.stringify(loggedIn.value));
    if (!saved.ok) return saved;
    deps.onChange?.();
    return ok(undefined);
  }

  return {
    async status() {
      const [stored, latestAck] = await Promise.all([
        readStored(),
        deps.acknowledgements.latest(INSTAGRAM_WARNING.feature),
      ]);
      if (!stored.ok) return stored;
      const acknowledgedAt =
        latestAck.ok && latestAck.value?.termsVersion === INSTAGRAM_WARNING.termsVersion
          ? latestAck.value.acknowledgedAt
          : undefined;
      return ok({
        signedIn: stored.value !== null,
        ...(stored.value?.username ? { username: stored.value.username } : {}),
        warning: INSTAGRAM_WARNING,
        ...(acknowledgedAt !== undefined ? { acknowledgedAt } : {}),
      });
    },

    signIn(input) {
      if (activeSignIn) return activeSignIn;
      const pending = runSignIn(input).finally(() => {
        activeSignIn = null;
      });
      activeSignIn = pending;
      return pending;
    },

    async signOut() {
      const deleted = await deps.secrets.delete(INSTAGRAM_SECRET_KEY);
      if (!deleted.ok) return deleted;
      deps.onChange?.();
      return ok(undefined);
    },

    async getCredential() {
      const stored = await readStored();
      if (!stored.ok) return stored;
      if (!stored.value) return ok(null);
      const sessionObj = toInstagramWebSession(stored.value);
      return ok({
        kind: 'api_key',
        secret: sessionObj.cookiesNetscape,
        headers: { ...sessionObj.headers },
        source: 'keychain',
      });
    },
  };
}

type ServedBroker = Pick<AuthBroker, 'get' | 'invalidate' | 'statuses'>;

export function withInstagramCredential(
  broker: ServedBroker,
  instagram: Pick<MainInstagramAuth, 'getCredential' | 'signOut'>,
  onInvalidated?: () => void,
): ServedBroker {
  return {
    get: async (provider, request) => {
      if (provider !== INSTAGRAM_PROVIDER) return broker.get(provider, request);
      const cred = await instagram.getCredential();
      return cred.ok ? ok(cred.value ?? undefined) : cred;
    },
    invalidate: (provider) => {
      if (provider === INSTAGRAM_PROVIDER) {
        void instagram.signOut().then(() => {
          onInvalidated?.();
        });
        return;
      }
      broker.invalidate?.(provider);
    },
    statuses: () => broker.statuses(),
  };
}
