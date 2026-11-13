#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Writes BUILDINFO.json for build.sh (macOS, dist/) and build-linux.sh (linux-x64, dist/linux-x64/).

The file holds the pins from versions.env, the configure line, each output's size and sha256, and the
reproducibility record (README, Reproducibility). That record is written by hand after two clean builds are
compared. build.sh used to drop it on every run, so a checkout that built FFmpeg showed BUILDINFO.json changed,
and the file's sha256 (which the app pins) moved. Now the record is carried over when this build's outputs are
the bytes it describes: from the BUILDINFO.json this build replaces, or else from the committed one. When the
bytes differ the record describes another build, so it is left out and this says why.

    python3 buildinfo.py [--target linux-x64] <root> <the replaced BUILDINFO.json, which may not exist>
"""
import hashlib
import json
import os
import pathlib
import subprocess
import sys

OUTPUTS = ("dist/ffmpeg", "dist/ffprobe", "dist/lib/libMoltenVK.dylib", "dist/lib/MoltenVK_icd.json")
# The record's name for each output's sha256.
RECORD_KEYS = {
    "dist/ffmpeg": "ffmpeg_sha256",
    "dist/ffprobe": "ffprobe_sha256",
    "dist/lib/libMoltenVK.dylib": "libMoltenVK_dylib_sha256",
    "dist/lib/MoltenVK_icd.json": "moltenvk_icd_sha256",
}
# versions.env names each source's pins <NAME>_VERSION, <NAME>_URL and <NAME>_SHA256.
SOURCES = (
    "ffmpeg", "fast_float", "glslang", "jinja2", "lcms2", "libplacebo", "markupsafe", "MoltenVK",
    "spirv-headers", "vulkan-headers", "vulkan-loader", "zimg",
)

# linux-x64: paths are relative to dist/linux-x64, the build folder @taalcut/media's target describes, and the
# record keeps one sha256 per output name. The build tools are pinned like sources, under LINUX_<NAME>_*.
LINUX_LIBRARIES = (
    "libavcodec.so.63", "libavdevice.so.63", "libavfilter.so.12", "libavformat.so.63", "libavutil.so.61",
    "libswresample.so.7", "libswscale.so.10",
)
LINUX_OUTPUTS = ("bin/ffmpeg", "bin/ffprobe") + tuple(f"lib/{name}" for name in LINUX_LIBRARIES)
LINUX_SOURCES = (
    "dav1d", "fast_float", "ffmpeg", "glslang", "jinja2", "lcms2", "libplacebo", "markupsafe", "nv-codec-headers",
    "openh264", "spirv-headers", "svt-av1", "vulkan-headers", "vulkan-loader", "zimg", "zlib",
)
LINUX_TOOLS = ("cmake", "meson")


def read_versions(path):
    """versions.env's KEY=VALUE lines, quotes stripped (no shell expansion there; the build scripts source it)."""
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            key, _, value = line.partition("=")
            if len(value) >= 2 and value[0] == value[-1] == '"':
                value = value[1:-1]
            values[key] = value
    return values


def hash_outputs(base, paths):
    outputs = []
    for rel in paths:
        data = (base / rel).read_bytes()
        outputs.append({
            "bytes": len(data),
            "name": pathlib.Path(rel).name,
            "path": rel,
            "sha256": hashlib.sha256(data).hexdigest(),
        })
    return sorted(outputs, key=lambda output: output["path"])


def committed_buildinfo(root, rel):
    """The committed BUILDINFO.json at `rel`, or None and why not (no git, not a checkout, not committed)."""
    env = {key: value for key, value in os.environ.items() if key != "GIT_CEILING_DIRECTORIES"}
    try:
        shown = subprocess.run(
            ["git", "-C", str(root), "show", f"HEAD:./{rel}"],
            capture_output=True, text=True, env=env, check=False,
        )
    except FileNotFoundError:
        return None, "git is not installed"
    if shown.returncode != 0:
        return None, (shown.stderr.strip().splitlines() or ["git show failed"])[0]
    return json.loads(shown.stdout), None


def mac_differences(record, outputs):
    built = {output["path"]: output["sha256"] for output in outputs}
    return [rel for rel, key in RECORD_KEYS.items() if record.get(key) != built[rel]]


def linux_differences(record, outputs):
    recorded = record.get("sha256") if isinstance(record.get("sha256"), dict) else {}
    return [output["path"] for output in outputs if recorded.get(output["name"]) != output["sha256"]]


def carried_record(candidates, outputs, differences):
    """The first candidate's record whose sha256s are all this build's, and from where; else None and why."""
    reasons = []
    for where, doc in candidates:
        record = doc.get("reproducibility")
        if not isinstance(record, dict):
            reasons.append(f"{where} has no record")
            continue
        differ = differences(record, outputs)
        if not differ:
            return record, where
        reasons.append(f"the record in {where} describes other bytes for {', '.join(differ)}")
    return None, "; ".join(reasons)


def pins(versions, name, prefix=""):
    key = prefix + name.upper().replace("-", "_")
    return {
        "name": name,
        "sha256": versions[f"{key}_SHA256"],
        "url": versions[f"{key}_URL"],
        "version": versions[f"{key}_VERSION"],
    }


def mac_doc(root, versions):
    return {
        "configure": (root / ".build" / "configure-line.txt").read_text().rstrip("\n"),
        "ffmpeg_version": versions["FFMPEG_VERSION"],
        "gpl": False,
        "license": "LGPL-2.1-or-later",
        "macos_min": versions["MACOS_MIN"],
        "nonfree": False,
        "outputs": hash_outputs(root, OUTPUTS),
        "source_date_epoch": int(versions["SOURCE_DATE_EPOCH"]),
        "sources": sorted((pins(versions, name) for name in SOURCES), key=lambda source: source["name"]),
    }


def linux_doc(root, versions):
    out = root / ".build" / "linux-x64" / "out"
    tools = dict(line.split(" ", 1) for line in (out / "toolchain.txt").read_text().splitlines() if line)
    packages = (out / "toolchain-packages.txt").read_bytes()
    return {
        "configure": (out / "configure-line.txt").read_text().rstrip("\n"),
        "ffmpeg_version": versions["FFMPEG_VERSION"],
        "glibc_min": "2.35",
        "gpl": False,
        "license": "LGPL-2.1-or-later",
        "nonfree": False,
        "outputs": hash_outputs(root / "dist" / "linux-x64", LINUX_OUTPUTS),
        "source_date_epoch": int(versions["SOURCE_DATE_EPOCH"]),
        "sources": sorted((pins(versions, name) for name in LINUX_SOURCES), key=lambda source: source["name"]),
        "target": "linux-x64",
        "toolchain": {
            **tools,
            "apt_packages": versions["LINUX_APT_PACKAGES"],
            "apt_snapshot": versions["LINUX_APT_SNAPSHOT"],
            "base_image": versions["LINUX_BASE_IMAGE"],
            "installed_packages_sha256": hashlib.sha256(packages).hexdigest(),
            "tools": [pins(versions, name, "LINUX_") for name in LINUX_TOOLS],
        },
    }


TARGETS = {
    "darwin-arm64": {"buildinfo": "dist/BUILDINFO.json", "doc": mac_doc, "differences": mac_differences},
    "linux-x64": {"buildinfo": "dist/linux-x64/BUILDINFO.json", "doc": linux_doc, "differences": linux_differences},
}


def build_doc(root, previous_path, target="darwin-arm64"):
    spec = TARGETS[target]
    doc = spec["doc"](root, read_versions(root / "versions.env"))
    candidates = []
    if previous_path.is_file():
        candidates.append(("the replaced BUILDINFO.json", json.loads(previous_path.read_text())))
    committed, why_not = committed_buildinfo(root, spec["buildinfo"])
    if committed is not None:
        candidates.append(("the committed BUILDINFO.json", committed))
    record, where = carried_record(candidates, doc["outputs"], spec["differences"])
    if record is not None:
        doc["reproducibility"] = record
        return doc, f"reproducibility record kept from {where}: every output is the bytes it describes"
    reasons = [where] if where else []
    if committed is None:
        reasons.append(f"no committed BUILDINFO.json: {why_not}")
    why = "; ".join(reasons)
    return doc, f"no reproducibility record ({why}). Compare two clean builds and add one (README, Reproducibility)"


def main(argv):
    args = argv[1:]
    target = "darwin-arm64"
    if args[:1] == ["--target"] and len(args) >= 2:
        target, args = args[1], args[2:]
    if len(args) != 2 or target not in TARGETS:
        print("usage: buildinfo.py [--target linux-x64] <root> <the replaced BUILDINFO.json>", file=sys.stderr)
        return 2
    root = pathlib.Path(args[0])
    doc, note = build_doc(root, pathlib.Path(args[1]), target)
    (root / TARGETS[target]["buildinfo"]).write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
    print(f"BUILDINFO.json: {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
