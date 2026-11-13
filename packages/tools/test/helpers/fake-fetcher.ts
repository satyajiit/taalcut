// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for yt-dlp, compiled at test time: a Mach-O like the real one
 * (a shell script would need /bin/sh to be executable under the profile,
 * which the fetcher profile doesn't allow). It connects to the link's
 * 127.0.0.1 port (proving the network is open), writes a short lavfi reel
 * with the bundled FFmpeg into the `-o` path, and prints that path.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = String.raw`
#include <arpa/inet.h>
#include <netinet/in.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;
int main(int argc, char **argv) {
  const char *out = NULL, *ffdir = NULL, *url = NULL;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "-o") && i + 1 < argc) out = argv[++i];
    else if (!strcmp(argv[i], "--ffmpeg-location") && i + 1 < argc) ffdir = argv[++i];
    else if (!strcmp(argv[i], "--") && i + 1 < argc) url = argv[++i];
  }
  if (!out || !ffdir || !url) return 2;
  const char *host = strstr(url, "127.0.0.1:");
  int connected = 0;
  if (host) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in a;
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET;
    a.sin_port = htons((unsigned short)atoi(host + 10));
    a.sin_addr.s_addr = htonl(0x7f000001);
    connected = connect(s, (struct sockaddr *)&a, sizeof a) == 0;
    close(s);
  }
  fprintf(stderr, "network:%s\n", connected ? "yes" : "no");
  const char *ext = strstr(out, "%(ext)s");
  if (!ext) return 3;
  char target[4096], ffmpeg[4096];
  snprintf(target, sizeof target, "%.*smp4", (int)(ext - out), out);
  snprintf(ffmpeg, sizeof ffmpeg, "%s/ffmpeg", ffdir);
  char *args[] = {ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                  "testsrc2=size=64x64:rate=10:duration=0.5", "-c:v", "h264_videotoolbox", target, NULL};
  pid_t pid;
  if (posix_spawn(&pid, ffmpeg, NULL, NULL, args, environ) != 0) return 4;
  int status;
  waitpid(pid, &status, 0);
  if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) return 5;
  printf("%s\n", target);
  return 0;
}
`;

/** Compiles the stand-in into `dir/yt-dlp` and puts a `deno` beside it; null when there's no compiler. */
export function buildFakeFetcher(dir: string): { binary: string; deno: string } | null {
  mkdirSync(dir, { recursive: true });
  const source = join(dir, 'fake-yt-dlp.c');
  const binary = join(dir, 'yt-dlp');
  writeFileSync(source, SOURCE);
  try {
    execFileSync('/usr/bin/cc', ['-O0', '-o', binary, source], { stdio: 'ignore', timeout: 60_000 });
    execFileSync('/bin/cp', ['/bin/echo', join(dir, 'deno')]);
  } catch {
    return null;
  }
  return { binary, deno: join(dir, 'deno') };
}
