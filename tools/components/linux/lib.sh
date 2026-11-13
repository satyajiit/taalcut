# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# Shared helpers for the linux-x64 pack scripts (sourced, POSIX sh, GNU tools). The archive recipe is the
# components' one (README.md, "Archives") made with GNU tar and zstd instead of macOS's bsdtar:
#   - regular files and relative symlinks only, names sorted in byte order, no directory entries;
#   - ustar, uid and gid 0, numeric owner, mtime 0, no xattrs, ACLs or SELinux labels;
#   - executables 0755 and other files 0644;
#   - the tar written to a file with 512-byte blocks, then zstd -19 reads the file (the frame records the content
#     size). zstd's output is the same for any -T of 1 or more, so the threads only change how long it takes.
# The same inputs, GNU tar and zstd versions give the same bytes; the summary records both versions.
#
# Environment: TAALCUT_COMPONENTS_CACHE (pinned downloads, by sha256; default tools/components/.cache/linux),
# TAALCUT_PACK_THREADS (zstd threads, default 4).

set -eu
export LC_ALL=C TZ=UTC

LINUX_DIR="${LINUX_DIR:?set LINUX_DIR to tools/components/linux before sourcing lib.sh}"
ROOT="$(cd "$LINUX_DIR/../../.." && pwd -P)"
CACHE="${TAALCUT_COMPONENTS_CACHE:-$ROOT/tools/components/.cache/linux}"
THREADS="${TAALCUT_PACK_THREADS:-4}"

die() { echo "error: $*" >&2; exit 1; }
sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
size_of() { stat -c %s "$1"; }

# fetch_pin URL SHA256 SIZE: the pinned file from the cache (downloaded once into it); prints its path. Refuses
# bytes that don't match the pin, and deletes them.
fetch_pin() {
  _url="$1" _sha="$2" _size="$3"
  mkdir -p "$CACHE/sha256"
  _dest="$CACHE/sha256/$_sha"
  if [ ! -f "$_dest" ]; then
    echo "fetch $_url" >&2
    curl -fsSL --retry 5 --retry-all-errors -o "$_dest.part" "$_url"
    mv "$_dest.part" "$_dest"
  fi
  if [ "$(size_of "$_dest")" != "$_size" ] || [ "$(sha256_of "$_dest")" != "$_sha" ]; then
    rm -f "$_dest"
    die "$_url does not match its pin ($_size bytes, sha256 $_sha)"
  fi
  echo "$_dest"
}

# check_elf_tree DIR GLIBC_MAX: every ELF file under DIR needs glibc GLIBC_MAX or older (so it runs on Ubuntu
# 22.04) and has no RPATH or RUNPATH outside its own folder ($ORIGIN); prints how many ELF files it checked.
check_elf_tree() {
  _dir="$1" _max="$2" _count=0
  for _f in $(find "$_dir" -type f | sort); do
    [ "$(head -c 4 "$_f" | od -An -tx1 | tr -d ' \n')" = "7f454c46" ] || continue
    _count=$((_count + 1))
    _need="$(readelf -V --wide "$_f" 2>/dev/null | grep -o 'GLIBC_[0-9][0-9.]*' | sed 's/GLIBC_//' | sort -uV | tail -n 1)"
    if [ -n "$_need" ] && [ "$(printf '%s\n%s\n' "$_need" "$_max" | sort -V | tail -n 1)" != "$_max" ]; then
      die "$_f needs glibc $_need (newer than $_max)"
    fi
    _paths="$(readelf -d --wide "$_f" 2>/dev/null | sed -n 's/.*(R\(UN\)\{0,1\}PATH).*\[\(.*\)\]/\2/p')"
    for _p in $(echo "$_paths" | tr ':' ' '); do
      case "$_p" in '$ORIGIN' | '$ORIGIN/' | '$ORIGIN/'*) ;; *) die "$_f has a search path outside its folder: $_p" ;; esac
    done
  done
  echo "$_count"
}

# pack_tree STAGE ARCHIVE: packs every file and symlink under STAGE into ARCHIVE (tar.zst) with the recipe above,
# changing modes and mtimes in STAGE. Prints the extracted size (the sum of the regular files' sizes).
pack_tree() {
  _stage="$1" _archive="$2"
  [ -z "$(find "$_stage" -type l -lname '/*')" ] || die "an absolute symlink in $_stage"
  [ -z "$(find "$_stage" ! -type f ! -type l ! -type d)" ] || die "a special file in $_stage"
  find "$_stage" -type f -perm /111 -exec chmod 0755 {} +
  find "$_stage" -type f ! -perm /111 -exec chmod 0644 {} +
  find "$_stage" \( -type f -o -type l \) -exec touch -h -d @0 {} +
  _list="$(mktemp)"
  (cd "$_stage" && find . \( -type f -o -type l \) | sed 's|^\./||' | sort) >"$_list"
  [ -s "$_list" ] || die "nothing to pack in $_stage"
  mkdir -p "$(dirname "$_archive")"
  tar --format=ustar --owner=0 --group=0 --numeric-owner --mtime=@0 --no-xattrs --no-acls --no-selinux \
    --no-recursion -b 1 -C "$_stage" -cf "$_archive.tar" -T "$_list"
  rm -f "$_list"
  zstd -19 -T"$THREADS" -q -f "$_archive.tar" -o "$_archive"
  rm -f "$_archive.tar"
  find "$_stage" -type f -printf '%s\n' | awk '{ s += $1 } END { printf "%d\n", s }'
}

# summary ARCHIVE EXTRACTED [EXTRA_JSON]: the one-line JSON every pack script prints last (hosting/recipes.mjs
# reads `archive`).
summary() {
  _tar="$(tar --version | head -n 1)"
  _zstd="$(zstd -V | sed -n 's/.* v\([0-9.]*\).*/\1/p')"
  printf '{"archive":"%s","sha256":"%s","size":%s,"extractedSize":%s,"tar":"%s","zstd":"%s"%s}\n' \
    "$1" "$(sha256_of "$1")" "$(size_of "$1")" "$2" "$_tar" "$_zstd" "${3:+,$3}"
}
