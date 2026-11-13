// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Language ID on one window (IX-A2): how much voice it needs. Each language the Mac has a `say` voice for is
 * spoken for about 15 s and whisper's tiny model (the persistent server when built, whisper-cli otherwise) asks
 * for the language of its first 2, 5 and 10 s, and of all of it. Pinned: at the configured enough-voice length
 * (LANGUAGE_WINDOW.enoughSpeechMs) every language is right, and whisper is surer there than at 2 s.
 * With TAALCUT_LID_REPORT set, the probabilities go to that file (the SPEC's table).
 * Needs FFmpeg, `say`, whisper and the tiny model; skips and says why without them.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSpeechPcm, writePcmRange } from '../../src/asset-audio/wav-file';
import { LANGUAGE_WINDOW } from '../../src/config';
import { createCliWhisperDecoder } from '../../src/whisper/cli-decoder';
import type { WhisperDecoder } from '../../src/whisper/decoder';
import { createWhisperServerPool, type WhisperServerPool } from '../../src/whisper/server-pool';
import { freeLoopbackPort, posixServerSpawn } from '../../src/whisper/server-spawn';
import { testMedia } from '../helpers/ffmpeg';
import { sayToWav } from '../helpers/speech';
import { whisperTools } from '../helpers/whisper';

/** whisper's code, the voices to try in order, and about 15 s of plain speech. */
const SPOKEN = [
  {
    code: 'en',
    voices: ['Samantha', 'Daniel'],
    text: 'The old lighthouse keeper climbed the stairs every evening to light the lamp. He watched the ships pass in the dark and wrote their names in a small notebook that he kept beside his bed.',
  },
  {
    code: 'es',
    voices: ['Paulina', 'Mónica'],
    text: 'Cada mañana la panadera abría la tienda antes de que saliera el sol. Los vecinos llegaban temprano para comprar pan caliente y hablar un rato sobre las noticias del pueblo.',
  },
  {
    code: 'pt',
    voices: ['Luciana', 'Joana'],
    text: 'O pescador saiu de casa muito cedo e caminhou até a praia. Ele preparou o barco com cuidado, olhou para o céu e decidiu que o mar estava calmo o bastante para trabalhar.',
  },
  {
    code: 'hi',
    voices: ['Lekha'],
    text: 'हर सुबह दादी बगीचे में पौधों को पानी देती थीं। बच्चे स्कूल जाने से पहले उनके साथ बैठकर कहानियाँ सुनते थे और फिर खुशी खुशी अपने बस्ते उठाकर निकल जाते थे।',
  },
  {
    code: 'fr',
    voices: ['Thomas', 'Amélie'],
    text: 'Le vieux libraire ouvrait sa boutique tous les matins à huit heures. Il rangeait les livres sur les étagères et discutait avec les clients qui cherchaient un roman pour le week-end.',
  },
  {
    code: 'de',
    voices: ['Anna'],
    text: 'Der alte Uhrmacher arbeitete jeden Tag in seiner kleinen Werkstatt am Marktplatz. Er reparierte Taschenuhren und erzählte den Kindern Geschichten über die Stadt, wie sie früher war.',
  },
  {
    code: 'it',
    voices: ['Alice'],
    text: 'Ogni sera la nonna preparava la cena per tutta la famiglia. I nipoti apparecchiavano la tavola e il nonno raccontava storie della sua giovinezza in campagna vicino al fiume.',
  },
  {
    code: 'ja',
    voices: ['Kyoko'],
    text: '毎朝、祖母は庭の花に水をやっていました。子どもたちは学校に行く前に祖母と一緒に座って、昔の話を聞くのが大好きでした。',
  },
  {
    code: 'ru',
    voices: ['Milena'],
    text: 'Каждое утро старый рыбак выходил к реке до восхода солнца. Он проверял сети, пил горячий чай из термоса и смотрел, как над водой поднимается туман.',
  },
  {
    code: 'zh',
    voices: ['Tingting'],
    text: '每天早上，老师都会提前来到学校，打开教室的窗户。学生们陆续走进来，向老师问好，然后安静地坐下来准备上课。',
  },
  {
    code: 'ko',
    voices: ['Yuna'],
    text: '매일 아침 할머니는 마당에 있는 꽃에 물을 주셨습니다. 아이들은 학교에 가기 전에 할머니 옆에 앉아 옛날 이야기를 듣는 것을 좋아했습니다.',
  },
] as const;

const LENGTHS_MS = [2000, 5000, LANGUAGE_WINDOW.enoughSpeechMs] as const;

const media = await testMedia('language window length');
const tools = await whisperTools();
const listed = await runProcess('say', ['-v', '?']);
const installedVoices = new Set(
  listed.ok
    ? listed.value.stdout
        .toString('utf8')
        .split('\n')
        .map((line) => /^(.+?)\s+[a-z]{2,3}_[A-Z0-9]{2,3}\s+#/.exec(line)?.[1]?.trim() ?? '')
    : [],
);
const cases = SPOKEN.flatMap(({ code, voices, text }) => {
  const voice = voices.find((name) => installedVoices.has(name));
  return voice ? [{ code, voice, text }] : [];
});
const skip =
  !media.ctx || !(tools.server || tools.cli) || !tools.tiny || !cases.some((c) => c.code === 'en')
    ? 'language window length: skipped (FFmpeg, whisper, ggml-tiny or an English `say` voice missing)'
    : '';
if (skip) console.warn(skip);

let dir = '';
let pool: WhisperServerPool | undefined;
let decoder: WhisperDecoder;

beforeAll(async () => {
  if (skip) return;
  dir = await mkdtemp(join(tmpdir(), 'taalcut-lid-length-'));
  if (tools.server) {
    pool = createWhisperServerPool({
      launch: { spawn: posixServerSpawn, fetch, freePort: freeLoopbackPort, workDir: dir },
      accelerator: 'metal',
    });
    decoder = pool.decoder(tools.server);
  } else {
    decoder = createCliWhisperDecoder({ binary: tools.cli });
  }
});

afterAll(async () => {
  await pool?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

interface Guess {
  readonly language: string;
  readonly probability: number;
}

describe.skipIf(Boolean(skip))('language ID on one window', () => {
  it('is right for every spoken language at the enough-voice length, and surer than at 2 s', async () => {
    const ctx = media.ctx;
    if (!ctx) return;
    const rows: { code: string; voice: string; spokenMs: number; byLength: Record<string, Guess> }[] = [];
    for (const { code, voice, text } of cases) {
      const wav = await sayToWav(ctx, dir, code, text, { voice, sampleRate: 16_000 });
      const pcm = await readSpeechPcm(wav);
      if (!pcm.ok) throw new Error(pcm.error.code);
      const byLength: Record<string, Guess> = {};
      for (const length of [...LENGTHS_MS, pcm.value.durationMs]) {
        const window = join(dir, `${code}-${length}.wav`);
        const written = await writePcmRange(pcm.value, { startMs: 0, endMs: length }, window);
        if (!written.ok) throw new Error(written.error.code);
        const guess = await decoder.identifyLanguage({ audio: window, model: tools.tiny });
        if (!guess.ok) throw new Error(`${code} ${length}: ${guess.error.code} ${guess.error.detail ?? ''}`);
        byLength[length === pcm.value.durationMs ? 'all' : String(length)] = guess.value;
      }
      rows.push({ code, voice, spokenMs: pcm.value.durationMs, byLength });
    }
    if (process.env.TAALCUT_LID_REPORT)
      await writeFile(process.env.TAALCUT_LID_REPORT, `${JSON.stringify(rows, null, 2)}\n`);

    const enough = String(LANGUAGE_WINDOW.enoughSpeechMs);
    expect(rows.map((row) => [row.code, row.byLength[enough]?.language])).toEqual(
      rows.map((row) => [row.code, row.code]),
    );
    const mean = (length: string) =>
      rows.reduce((sum, row) => sum + (row.byLength[length]?.probability ?? 0), 0) / rows.length;
    expect(mean(enough)).toBeGreaterThanOrEqual(mean('2000'));
  }, 300_000);
});
