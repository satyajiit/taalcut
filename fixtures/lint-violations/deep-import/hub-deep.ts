// Copied to packages/agent/src/__lint_fixture_hub_deep.ts before the tools run.
// Core's hub entry ('@taalcut/core/hub') is public; a file inside src/hub/ is not, by name or by path.
import { hubContentProblems } from '@taalcut/core/src/hub/content-rules';
import { hubTemplateV0Schema } from '../../core/src/hub/hub-template.ts';

export const hubDeep = { hubContentProblems, hubTemplateV0Schema };
