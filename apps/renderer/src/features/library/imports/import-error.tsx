// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ComponentProps } from 'react';
import { ErrorLine } from '@taalcut/ui';
import { useCommand } from '../../../backend/use-command';
import { fixCommand } from '../../../backend/fix-command';

export function ImportError(props: Omit<ComponentProps<typeof ErrorLine>, 'onFix'>) {
  const command = useCommand();
  return <ErrorLine {...props} onFix={(fix) => command.run(fixCommand(fix))} />;
}
