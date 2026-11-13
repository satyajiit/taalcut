// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { DeviceImportRunId } from '@taalcut/core';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { ApprovalDialog } from '../connect/approval-dialog';
import { useTransferSession, type TransferSessionApi } from '../use-transfer-session';

/** Reception shared by Library, onboarding and the rest of the app. */
export interface PhoneFlow {
  /** One explicit Wi-Fi connection; changing routes never closes reception. */
  readonly transfer: TransferSessionApi;
  readonly connect: () => void;
  /** The cable import started from the Cable tab, so Transfers can follow it. */
  readonly cableRun: DeviceImportRunId | null;
  readonly setCableRun: (runId: DeviceImportRunId | null) => void;
}

const Flow = createContext<PhoneFlow | null>(null);

/** The shell owns reception. Route changes only replace observers, never the active connection. */
export function PhoneFlowProvider({ children }: { children: ReactNode }) {
  const [asked, setAsked] = useState(false);
  const transfer = useTransferSession({ enabled: asked, background: true });
  const [cableRun, setCableRun] = useState<DeviceImportRunId | null>(null);
  // The session is a new object on every change it streams, so the value follows it as is.
  return (
    <Flow.Provider value={{ transfer, cableRun, setCableRun, connect: () => setAsked(true) }}>
      {children}
      <ApprovalDialog transfer={transfer} />
    </Flow.Provider>
  );
}

export function usePhoneFlow(): PhoneFlow {
  const flow = useContext(Flow);
  // A bug, not a state the person can reach: every phone tab renders inside the layout route.
  if (!flow) throw new Error('usePhoneFlow() is used outside PhoneFlowProvider');
  return flow;
}
