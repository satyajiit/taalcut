// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the evals decode and encode H.264 with the bundled FFmpeg (LNX1-PKG). VideoToolbox where the build lists it,
 * which is the Mac's build, as before. Otherwise libopenh264, the LGPL software encoder the Linux build has, with
 * software decode. A build with neither is refused by name.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseEncoders } from '@taalcut/media';

const exec = promisify(execFile);

export interface H264Route {
  /** Input options for the decode, before `-i`. */
  readonly decode: readonly string[];
  readonly encoder: string;
}

/** The route for the encoders `ffmpeg -encoders` listed. */
export function h264RouteFor(encoders: ReadonlySet<string>): H264Route {
  if (encoders.has('h264_videotoolbox'))
    return { decode: ['-hwaccel', 'videotoolbox'], encoder: 'h264_videotoolbox' };
  if (encoders.has('libopenh264')) return { decode: [], encoder: 'libopenh264' };
  throw new Error('the bundled FFmpeg has neither h264_videotoolbox nor libopenh264');
}

const routes = new Map<string, Promise<H264Route>>();

/** The route for this FFmpeg binary, asked once per path. */
export function h264Route(ffmpeg: string): Promise<H264Route> {
  let route = routes.get(ffmpeg);
  if (!route) {
    route = exec(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 30_000 }).then(({ stdout }) =>
      h264RouteFor(new Set(parseEncoders(stdout).map((encoder) => encoder.name))),
    );
    routes.set(ffmpeg, route);
  }
  return route;
}
