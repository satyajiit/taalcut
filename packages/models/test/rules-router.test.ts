// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The on-device rules router (models SPEC P3.5) against spike 04's 204 labelled creator utterances
 * (`test/fixtures/router/`, copied from `.spikes/04-router/`): it must score at least the spike's keyword
 * baseline (decision 0.745, family 0.652 on the needs-tool rows), and it never touches the network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createClassifier,
  createMemoryCloudCallSink,
  createModelRuntime,
  createStaticCredentialProvider,
  disableNetwork,
  RULES_ROUTER,
  RULES_ROUTER_CONFIG,
  type ClassifyRequest,
} from '@taalcut/models';

interface Task {
  readonly id: string;
  readonly utterance: string;
  readonly context: string;
  readonly expected: { decision: 'none' | 'family' | 'tool'; family: string | null; tool: string | null };
}
interface Catalogue {
  readonly families: readonly { id: string; description: string }[];
  readonly tools: readonly { id: string; family: string; description: string }[];
}

const dir = join(import.meta.dirname, 'fixtures', 'router');
const catalogue = JSON.parse(readFileSync(join(dir, 'catalogue.json'), 'utf8')) as Catalogue;
const tasks = readFileSync(join(dir, 'tasks.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as Task);

const options = Object.fromEntries(catalogue.families.map((f) => [f.id, f.description]));
const hints = Object.fromEntries(
  catalogue.families.map((f) => [
    f.id,
    catalogue.tools
      .filter((t) => t.family === f.id)
      .map((t) => `${t.id}: ${t.description}`)
      .join('\n'),
  ]),
);
const question = { type: 'choice' as const, instructions: 'Which tool family next, or none?', options };

function rules() {
  const callLog = createMemoryCloudCallSink();
  const classifier = createClassifier({
    runtime: createModelRuntime({ builtinProviders: [] }),
    credentials: createStaticCredentialProvider({}),
    callLog,
    chain: [RULES_ROUTER],
  });
  return { classifier, callLog };
}

const request = (task: Task): ClassifyRequest => ({
  state: { message: task.utterance, context: task.context },
  questions: { family: question },
  localHints: { family: hints },
});

const family = (task: Task) => task.expected.family ?? task.expected.tool?.split('.')[0] ?? null;

describe('rules router on spike 04 tasks', () => {
  it('beats the heuristic baseline on decision and family accuracy, with no request sent', async () => {
    const guard = disableNetwork();
    try {
      const { classifier, callLog } = rules();
      let decisions = 0;
      let families = 0;
      let needsTool = 0;
      for (const task of tasks) {
        const result = await classifier.classify(request(task));
        if (!result.ok) throw new Error(result.error.code);
        const answer = result.value.answers.family;
        const choice = answer?.type === 'choice' ? answer.choice : 'none';
        const wanted = family(task);
        if ((choice !== 'none') === (wanted !== null)) decisions += 1;
        if (wanted !== null) {
          needsTool += 1;
          if (choice === wanted) families += 1;
        }
      }
      const decision = decisions / tasks.length;
      const familyAccuracy = families / needsTool;
      expect(tasks).toHaveLength(204);
      expect(decision, `decision accuracy ${decision.toFixed(3)}`).toBeGreaterThanOrEqual(0.745);
      expect(familyAccuracy, `family accuracy ${familyAccuracy.toFixed(3)}`).toBeGreaterThanOrEqual(0.652);
      // Every decision is a local, free row: the privacy panel sees routing ran on this Mac.
      expect(callLog.records).toHaveLength(204);
      expect(callLog.records.every((r) => r.local && r.costUsd === 0 && r.bytesSent === 0)).toBe(true);
    } finally {
      guard.restore();
    }
  });

  it('answers with normalised probabilities and the winner as its confidence', async () => {
    const { classifier } = rules();
    const result = await classifier.classify({
      state: { message: 'transcribe what she says' },
      questions: { family: question },
    });
    expect(result).toMatchObject({
      ok: true,
      value: { provider: 'taalcut', model: 'rules-router', local: true, costUsd: 0, inputTokens: 0 },
    });
    const answer = result.ok ? result.value.answers.family : undefined;
    expect(answer).toMatchObject({ type: 'choice', choice: 'audio' });
    if (answer?.type !== 'choice') throw new Error('not a choice');
    const total = Object.values(answer.probabilities).reduce((sum, p) => sum + p, 0);
    expect(total).toBeCloseTo(1, 2);
    expect(answer.confidence).toBe(answer.probabilities.audio);
  });

  it('says none for chat and below the minimum score, in every v1 language', async () => {
    const { classifier } = rules();
    for (const message of ['hello', 'gracias', 'obrigado', 'नमस्ते', 'what does LUFS mean', 'hmm']) {
      const result = await classifier.classify({ state: { message }, questions: { family: question } });
      const answer = result.ok ? result.value.answers.family : undefined;
      expect(answer, message).toMatchObject({ type: 'choice', choice: 'none' });
    }
    expect(RULES_ROUTER_CONFIG.minScore).toBeGreaterThan(0);
  });

  it('routes Hindi, Spanish and Portuguese requests to their family', async () => {
    const { classifier } = rules();
    const cases: [string, string][] = [
      ['इस फ्रेम में क्या दिख रहा है?', 'vision'],
      ['hazlo más corto', 'timeline'],
      ['exportar o vídeo com legendas', 'render'],
      ['transcrever o áudio', 'audio'],
    ];
    for (const [message, wanted] of cases) {
      const result = await classifier.classify({ state: { message }, questions: { family: question } });
      const answer = result.ok ? result.value.answers.family : undefined;
      expect(answer, message).toMatchObject({ choice: wanted });
    }
  });

  it('refuses a question it cannot answer instead of guessing', async () => {
    const { classifier } = rules();
    const result = await classifier.classify({
      state: { message: 'export it' },
      questions: { tool: { type: 'bool', instructions: 'Tool?', yes: 'yes', no: 'no' } },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'models.model_unsuitable' } });
  });
});
