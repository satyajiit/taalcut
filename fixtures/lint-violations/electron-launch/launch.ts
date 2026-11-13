// Copied to apps/desktop/e2e/__lint_fixture_launch.ts (not e2e/launch.ts) before ESLint runs.
import { _electron } from '@playwright/test';

export const direct = () => _electron.launch({ args: ['.'] });
export const dynamic = async () => (await import('@playwright/test'))._electron.launch({ args: ['.'] });
