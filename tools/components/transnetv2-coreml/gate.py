# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The `transnetv2-coreml` parity gate (IX2-S8), from pack-transnetv2-coreml.sh:
#
#   gate.py <TransNetV2.mlmodelc> <transnetv2.onnx> <footageDir> <ffmpeg> <ffprobe> <report.json> [units]
#
# Every video in footageDir (ix-v1: tools/bench-footage) is decoded by ffmpeg to 48x27 rgb24 (no hardware decode),
# every n-th frame kept as vision.shots streams it (n the whole number nearest fps / 30, 1 at 30 fps or under), and
# cut into upstream's windows (100 frames every 50, the middle 50 kept). The compiled Core ML model (on `units`,
# default cpuAndGPU) and the shipped ONNX (onnxruntime, CPU) predict every window. The transition rules
# (packages/vision/src/cuts/transitions.ts) read only the runs of single > 0.5 (a run at frame 0 skipped) and the
# many-hot span around each (widened while many-hot > 0.5), so the gate wants those runs and spans equal for every
# clip; it also wants the largest difference under 1e-3. Writes the report (max |diff|, frames across 0.5,
# transitions compared) and exits 1 when the gate fails.
import json, os, subprocess, sys
import numpy as np
import coremltools as ct
import onnxruntime as ort

mlmodelc, onnx_path, footage, ffmpeg, ffprobe, report_path = sys.argv[1:7]
units_name = sys.argv[7] if len(sys.argv) > 7 else 'cpuAndGPU'
UNITS = {'cpuAndGPU': ct.ComputeUnit.CPU_AND_GPU, 'cpuAndNeuralEngine': ct.ComputeUnit.CPU_AND_NE,
         'cpuOnly': ct.ComputeUnit.CPU_ONLY, 'all': ct.ComputeUnit.ALL}
MAX_FPS, LIMIT = 30, 1e-3


def frame_rate(path: str) -> float:
    out = subprocess.run([ffprobe, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate',
                          '-of', 'csv=p=0', path], check=True, capture_output=True, text=True).stdout.strip()
    # A rotated clip's line ends with its side data's (empty) fields: "30/1,".
    num, den = out.splitlines()[0].split(',')[0].split('/')
    return int(num) / int(den)


def frames_of(path: str) -> np.ndarray:
    fps = frame_rate(path)
    every = 1 if fps <= MAX_FPS else round(fps / MAX_FPS)
    raw = subprocess.run([ffmpeg, '-v', 'error', '-nostdin', '-i', path, '-an', '-vf', 'scale=48:27',
                          '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 27, 48, 3)[::every]


def windows_of(frames: np.ndarray) -> np.ndarray:
    n = len(frames)
    end = 25 + 50 - (n % 50 if n % 50 != 0 else 50)
    padded = np.concatenate([np.repeat(frames[:1], 25, 0), frames, np.repeat(frames[-1:], end, 0)])
    return np.stack([padded[s:s + 100] for s in range(0, len(padded) - 50, 50)]).astype(np.float32)


def runs(single):
    over = np.concatenate([single > 0.5, [False]])
    out, start = [], None
    for k, o in enumerate(over):
        if o and start is None:
            start = k
        if not o and start is not None:
            out.append((start, k - 1))
            start = None
    return [r for r in out if r[0] != 0]


def spans(single, many):
    out = []
    for a, b in runs(single):
        while a > 0 and many[a - 1] > 0.5:
            a -= 1
        while b + 1 < len(many) and many[b + 1] > 0.5:
            b += 1
        out.append((a, b))
    return out


def main():
    session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name
    model = ct.models.CompiledMLModel(mlmodelc, compute_units=UNITS[units_name])
    videos = sorted(f for f in os.listdir(footage) if f.endswith(('.mov', '.mp4')))
    if not videos:
        raise SystemExit(f'error: no videos in {footage}')
    worst, flips, transitions, frames_compared, differ = 0.0, 0, 0, 0, []
    for name in videos:
        wins = windows_of(frames_of(os.path.join(footage, name)))
        theirs = [session.run(None, {input_name: w[None]}) for w in wins]
        mine = [model.predict({'frames': w[None]}) for w in wins]
        rs = np.concatenate([o[0][0, 25:75, 0] for o in theirs])
        rm = np.concatenate([o[1][0, 25:75, 0] for o in theirs])
        s = np.concatenate([o['single'][0, 25:75, 0] for o in mine])
        m = np.concatenate([o['many_hot'][0, 25:75, 0] for o in mine])
        worst = max(worst, float(np.abs(s - rs).max()), float(np.abs(m - rm).max()))
        flips += int(((s > 0.5) != (rs > 0.5)).sum() + ((m > 0.5) != (rm > 0.5)).sum())
        frames_compared += len(s)
        a, b = list(zip(runs(s), spans(s, m))), list(zip(runs(rs), spans(rs, rm)))
        transitions += len(b)
        if a != b:
            differ.append({'file': name, 'coreml': sorted(set(a) - set(b)), 'onnx': sorted(set(b) - set(a))})
        print(f'{name}: {len(wins)} windows, {len(b)} transitions', flush=True)
    report = {'units': units_name, 'videos': len(videos), 'framesCompared': frames_compared,
              'transitions': transitions, 'maxAbsDiff': worst, 'thresholdFlips': flips, 'differ': differ,
              'passed': not differ and worst < LIMIT}
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=1)
    print(json.dumps(report), flush=True)
    if not report['passed']:
        raise SystemExit('error: the Core ML model does not give the ONNX model\'s transitions')


if __name__ == '__main__':
    main()
