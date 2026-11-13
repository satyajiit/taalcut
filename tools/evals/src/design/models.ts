// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * eval:design's models from its options (HFW1 dsn): the Designer (the stand-in, the 9B through Taalcut's MLX server,
 * a model behind an OpenAI-compatible endpoint, or a ChatGPT plan's model as the app runs it) and the judge (an
 * endpoint's vision model, or the plan's). A plan needs the evals' own sign-in (`eval:signin chatgpt`); its session's
 * scrub then covers every line and file the run writes.
 */
import type { ReasoningLevel } from '@taalcut/models';
import type { DesignerModel } from '@taalcut/render';
import { signedInPlan, type PlanOptions, type PlanSession } from '../plan/chatgpt';
import type { RunningServer } from './mlx-server';
import { clientDesigner } from './plan-designer';
import { clientJudge, endpointJudge, type JudgeAsk } from './judge';
import { CLOUD_CALL_LIMITS, LOCAL_CALL_LIMITS, openAiDesigner } from './openai-designer';

export interface DesignModelOptions {
  readonly standIn: boolean;
  readonly model: string;
  /** A plan to run the Designer on ('chatgpt'). */
  readonly plan?: string;
  readonly reasoning?: ReasoningLevel;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly vision: boolean;
  readonly judgePlan?: string;
  readonly judgeBaseUrl?: string;
  readonly judgeApiKey?: string;
  readonly judgeModel?: string;
  /** Tests only: the plan's home, mock OAuth and provider. */
  readonly planOptions?: PlanOptions;
  /** Where a failed plan call's line goes (default: stdout). */
  readonly log?: (line: string) => void;
}

export interface DesignModels {
  readonly live: DesignerModel | null;
  readonly judge: JudgeAsk | null;
  /** The run's label, asked at the end (with the malformed calls counted so far). */
  readonly label: () => string;
  readonly scrub: (text: string) => string;
}

export async function designModels(options: DesignModelOptions, server: RunningServer | null): Promise<DesignModels> {
  let session: PlanSession | null = null;
  const planned = async (plan: string) => (session ??= await signedInPlan(plan, options.planOptions));
  let malformed = 0;
  let live: DesignerModel | null = null;
  let name = 'stand-in';
  if (options.plan) {
    const plan = await planned(options.plan);
    live = clientDesigner({
      client: plan.client(options.model, options.reasoning),
      seesImages: plan.seesImages(options.model),
      scrub: plan.scrub,
      lastRequest: plan.lastRequest,
      onFailure: options.log ?? ((line) => console.log(line)),
      ...CLOUD_CALL_LIMITS,
    });
    name = `${options.model} (ChatGPT plan${options.reasoning ? `, ${options.reasoning} thinking` : ''})`;
  } else if (!options.standIn) {
    live = openAiDesigner({
      baseUrl: server?.baseUrl ?? options.baseUrl!,
      apiKey: server?.apiKey ?? options.apiKey ?? '',
      model: options.model,
      seesImages: options.vision,
      thinkingOff: server !== null,
      onMalformed: () => malformed++,
      // A runaway answer fails its case, never the run.
      ...(server ? LOCAL_CALL_LIMITS : CLOUD_CALL_LIMITS),
    });
    name = `${options.model}${server ? ' (MLX, thinking off)' : ''}`;
  }
  let judge: JudgeAsk | null = null;
  if (options.judgeModel && options.judgePlan) judge = clientJudge((await planned(options.judgePlan)).client(options.judgeModel));
  else if (options.judgeModel && options.judgeBaseUrl)
    judge = endpointJudge({ baseUrl: options.judgeBaseUrl, apiKey: options.judgeApiKey ?? '', model: options.judgeModel });
  const scrub = (text: string) => (session ? session.scrub(text) : text);
  return { live, judge, label: () => `${name}${malformed ? `, ${malformed} malformed calls` : ''}`, scrub };
}
