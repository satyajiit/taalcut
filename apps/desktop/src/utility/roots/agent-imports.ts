// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, type Container } from '@taalcut/core';
import { createImportCommands } from '@taalcut/library';
import { AgentMainServicesToken } from '../../shared/tokens';

export function agentImportCommands(container: Container) {
  return createImportCommands((operation) =>
    callRpc(container.resolve(AgentMainServicesToken)().importsControl.execute(operation)),
  );
}
