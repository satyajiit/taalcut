// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace shell's seccomp filter on Linux (AGT2 sbx), a classic BPF program bwrap installs (`--seccomp 3`)
 * before it runs the shell. It refuses (EPERM) what a confined shell has no use for and what widens the kernel it
 * can reach: io_uring (which seccomp can't see into), nested user namespaces, keyrings, eBPF, perf, userfaultfd,
 * modules, kexec, mounts and namespace switches, the kernel log, handle-based opens, and TIOCSTI. clone3 is ENOSYS,
 * so libc falls back to clone, whose flags the filter can read. Another architecture's or the x32 ABI's calls kill
 * the process. Generated here (no libseccomp, no build tool); x86_64 only, like the Linux components.
 *
 * Inet sockets stay: `--unshare-net` leaves the shell a loopback of its own and no route out, and the HyperFrames
 * CLI serves the composition to Chrome on it.
 */

/** struct sock_filter's codes. */
const LD_W_ABS = 0x20;
const JEQ_K = 0x15;
const JSET_K = 0x45;
const JGE_K = 0x35;
const RET_K = 0x06;

const RET_ALLOW = 0x7fff0000;
const RET_KILL_PROCESS = 0x80000000;
const retErrno = (errno: number) => 0x00050000 | (errno & 0xffff);
const EPERM = 1;
const ENOSYS = 38;

const AUDIT_ARCH_X86_64 = 0xc000003e;
const X32_SYSCALL_BIT = 0x40000000;
const CLONE_NEWUSER = 0x10000000;
const TIOCSTI = 0x5412;

/** struct seccomp_data: nr at 0, arch at 4, args[i] at 16 + 8i (the low word, little-endian). */
const NR = 0;
const ARCH = 4;
const arg = (i: number) => 16 + 8 * i;

/** x86_64 numbers. */
export const SECCOMP_DENIED: Readonly<Record<string, number>> = {
  syslog: 103,
  pivot_root: 155,
  mount: 165,
  umount2: 166,
  kexec_load: 246,
  add_key: 248,
  request_key: 249,
  keyctl: 250,
  init_module: 175,
  delete_module: 176,
  perf_event_open: 298,
  name_to_handle_at: 303,
  open_by_handle_at: 304,
  setns: 308,
  finit_module: 313,
  kexec_file_load: 320,
  bpf: 321,
  userfaultfd: 323,
  io_uring_setup: 425,
  io_uring_enter: 426,
  io_uring_register: 427,
  open_tree: 428,
  move_mount: 429,
  fsopen: 430,
  fsconfig: 431,
  fsmount: 432,
  fspick: 433,
  mount_setattr: 442,
};
const SYS_IOCTL = 16;
const SYS_CLONE = 56;
const SYS_UNSHARE = 272;
const SYS_CLONE3 = 435;

interface Insn {
  readonly code: number;
  readonly k: number;
  /** Labels or relative offsets (0: the next instruction). */
  readonly jt?: string | number;
  readonly jf?: string | number;
  readonly label?: string;
}

const ld = (offset: number, label?: string): Insn => ({
  code: LD_W_ABS,
  k: offset,
  ...(label ? { label } : {}),
});
const jump = (code: number, k: number, jt: string | number, jf: string | number): Insn => ({
  code,
  k,
  jt,
  jf,
});
const ret = (k: number, label?: string): Insn => ({ code: RET_K, k, ...(label ? { label } : {}) });

/** The program as instructions, jumps still named. */
function program(): Insn[] {
  const denied = Object.values(SECCOMP_DENIED);
  return [
    ld(ARCH),
    jump(JEQ_K, AUDIT_ARCH_X86_64, 0, 'kill'),
    ld(NR),
    jump(JGE_K, X32_SYSCALL_BIT, 'kill', 0),
    ...denied.map((nr) => jump(JEQ_K, nr, 'eperm', 0)),
    jump(JEQ_K, SYS_CLONE3, 'enosys', 0),
    jump(JEQ_K, SYS_CLONE, 'flags', 0),
    jump(JEQ_K, SYS_UNSHARE, 'flags', 0),
    jump(JEQ_K, SYS_IOCTL, 'ioctl', 'allow'),
    // clone(flags, …) and unshare(flags): never a new user namespace.
    ld(arg(0), 'flags'),
    jump(JSET_K, CLONE_NEWUSER, 'eperm', 'allow'),
    // ioctl(fd, TIOCSTI, …): no typing into a terminal.
    ld(arg(1), 'ioctl'),
    jump(JEQ_K, TIOCSTI, 'eperm', 'allow'),
    ret(RET_ALLOW, 'allow'),
    ret(retErrno(EPERM), 'eperm'),
    ret(retErrno(ENOSYS), 'enosys'),
    ret(RET_KILL_PROCESS, 'kill'),
  ];
}

/** The filter's bytes: struct sock_filter[] (u16 code, u8 jt, u8 jf, u32 k), little-endian. */
export function shellSeccompFilter(): Uint8Array {
  const insns = program();
  const at = new Map(insns.flatMap((insn, i) => (insn.label ? [[insn.label, i] as const] : [])));
  const offset = (from: number, target: string | number | undefined): number => {
    if (target === undefined || typeof target === 'number') return target ?? 0;
    const to = at.get(target);
    if (to === undefined || to <= from) throw new Error(`seccomp: bad jump to ${target}`);
    const distance = to - from - 1;
    if (distance > 255) throw new Error('seccomp: jump too far');
    return distance;
  };
  const bytes = Buffer.alloc(insns.length * 8);
  insns.forEach((insn, i) => {
    bytes.writeUInt16LE(insn.code, i * 8);
    bytes.writeUInt8(offset(i, insn.jt), i * 8 + 2);
    bytes.writeUInt8(offset(i, insn.jf), i * 8 + 3);
    bytes.writeUInt32LE(insn.k >>> 0, i * 8 + 4);
  });
  return new Uint8Array(bytes);
}

/** What the filter does with one call (an interpreter of the program, for tests and the SPEC's table). */
export function seccompVerdict(
  filter: Uint8Array,
  call: { readonly arch?: number; readonly nr: number; readonly args?: readonly number[] },
): 'allow' | 'eperm' | 'enosys' | 'kill' {
  const view = Buffer.from(filter);
  const data = (offset: number) => {
    if (offset === ARCH) return call.arch ?? AUDIT_ARCH_X86_64;
    if (offset === NR) return call.nr;
    return call.args?.[(offset - 16) / 8] ?? 0;
  };
  let acc = 0;
  for (let pc = 0; pc * 8 < view.length;) {
    const code = view.readUInt16LE(pc * 8);
    const jt = view.readUInt8(pc * 8 + 2);
    const jf = view.readUInt8(pc * 8 + 3);
    const k = view.readUInt32LE(pc * 8 + 4);
    if (code === LD_W_ABS) acc = data(k) >>> 0;
    else if (code === RET_K) {
      if (k === RET_ALLOW) return 'allow';
      if (k === RET_KILL_PROCESS) return 'kill';
      return (k & 0xffff) === ENOSYS ? 'enosys' : 'eperm';
    } else {
      const taken =
        code === JEQ_K ? acc === k : code === JGE_K ? acc >= k : code === JSET_K ? (acc & k) !== 0 : false;
      pc += 1 + (taken ? jt : jf);
      continue;
    }
    pc += 1;
  }
  throw new Error('seccomp: fell off the end');
}
