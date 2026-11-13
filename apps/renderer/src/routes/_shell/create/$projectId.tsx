// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createFileRoute } from '@tanstack/react-router';
import { parseId } from '@taalcut/core';
import { CreateWorkspace } from '../../../features/create/create-workspace';
import { CREATION_STEPS, type CreationStep } from '../../../features/create/create-words';
import { NotFound } from '../../../shell/not-found';
export const Route = createFileRoute('/_shell/create/$projectId')({
  validateSearch: (search: Record<string, unknown>): { step?: CreationStep } => ({
    step: CREATION_STEPS.includes(search.step as CreationStep) ? (search.step as CreationStep) : 'brief',
  }),
  component: Creation,
});
function Creation() {
  const projectId = parseId<'Project'>(Route.useParams().projectId);
  const navigate = Route.useNavigate();
  const { step } = Route.useSearch();
  if (!projectId.ok) return <NotFound />;
  return (
    <CreateWorkspace
      projectId={projectId.value}
      step={step ?? 'brief'}
      onStep={(next) => void navigate({ search: { step: next } })}
    />
  );
}
