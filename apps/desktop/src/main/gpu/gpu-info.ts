// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * GpuInfo: the GPU devices and Chromium's feature status, for Settings →
 * About and the hardware tier (P1-E4), plus the CPU fallbacks ADR 0002 wants
 * logged. Main-process only; the renderer will reach it through the oRPC
 * contract (P1-C3).
 *
 * Chromium's feature status is a placeholder (everything 'disabled_software')
 * until the GPU process sends its first 'gpu-info-update', shortly after
 * ready, so create the service before ready and read() waits for that.
 */
import { gpuDisablingSwitches, toGpuReport, type GpuReport } from './gpu-report';

/** The part of Electron's app used here. */
export interface GpuAppPort {
  isHardwareAccelerationEnabled(): boolean;
  getGPUFeatureStatus(): object;
  getGPUInfo(infoType: 'basic'): Promise<unknown>;
  on(event: 'gpu-info-update', listener: () => void): unknown;
}

/** The part of Electron's app.commandLine used here. */
export interface CommandLinePort {
  hasSwitch(name: string): boolean;
  getSwitchValue(name: string): string;
}

export interface GpuInfo {
  /** Waits for the GPU process's first report (at most timeoutMs), then reads everything afresh. */
  read(): Promise<GpuReport>;
}

export const GPU_REPORT_TIMEOUT_MS = 5_000;

export function createGpuInfo(
  app: GpuAppPort,
  commandLine: CommandLinePort,
  options: { timeoutMs?: number } = {},
): GpuInfo {
  let reported = false;
  let markReported = (): void => {};
  const firstReport = new Promise<void>((resolve) => {
    markReported = resolve;
  });
  app.on('gpu-info-update', () => {
    reported = true;
    markReported();
  });

  return {
    async read() {
      if (!reported) await within(firstReport, options.timeoutMs ?? GPU_REPORT_TIMEOUT_MS);
      let basicInfo: unknown;
      let gpuInfoError: string | undefined;
      try {
        basicInfo = await app.getGPUInfo('basic');
      } catch (cause) {
        // With the GPU off, Chromium rejects with "GPU access not allowed. Reason: …".
        gpuInfoError = cause instanceof Error ? cause.message : String(cause);
      }
      return toGpuReport({
        hardwareAcceleration: app.isHardwareAccelerationEnabled(),
        featureStatus: app.getGPUFeatureStatus(),
        basicInfo,
        gpuInfoError,
        switches: gpuDisablingSwitches(commandLine),
        statusReported: reported,
      });
    },
  };
}

/** ADR 0002: a CPU route is logged with its reason. Returns whether there was one. */
export function logCpuFallbacks(report: GpuReport, warn: (line: string) => void = console.warn): boolean {
  if (report.cpuFallbacks.length === 0) return false;
  warn(`[gpu] CPU fallback ${JSON.stringify(report.cpuFallbacks)}`);
  return true;
}

async function within(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  } finally {
    clearTimeout(timer);
  }
}
