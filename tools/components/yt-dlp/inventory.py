# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""What a PyInstaller build of yt-dlp collected, for inventory.mjs.

Run with the build venv's Python: python inventory.py <pyinstaller work dir> <yt-dlp source dir>.
Prints one JSON object: every file the build collected (from PyInstaller's TOC files) and every
distribution installed in the venv with its declared licence and its files, so inventory.mjs can tell
which distributions are in the bundle and what each one is licensed under. Reads only; runs nothing.
"""
import ast
import importlib.metadata
import json
import os
import sys
import sysconfig


def toc_paths(work):
    paths = set()
    for name in sorted(os.listdir(work)):
        if not name.endswith('.toc'):
            continue
        with open(os.path.join(work, name), encoding='utf-8') as handle:
            data = ast.literal_eval(handle.read())
        stack = [data]
        while stack:
            item = stack.pop()
            if isinstance(item, (list, tuple)):
                if len(item) == 3 and all(isinstance(x, str) for x in item) and os.path.isabs(item[1]):
                    paths.add(os.path.realpath(item[1]))
                else:
                    stack.extend(item)
    return sorted(paths)


def licence_files(files):
    """The licence texts a distribution installs: its .dist-info's licenses/ folder, LICENSE*, COPYING*, NOTICE*."""
    names = ('LICENSE', 'COPYING', 'NOTICE')
    return [f for f in files if '.dist-info/' in f
            and ('/licenses/' in f or os.path.basename(f).upper().startswith(names))]


def distributions():
    found = []
    for dist in importlib.metadata.distributions():
        meta = dist.metadata
        files = sorted(os.path.realpath(str(dist.locate_file(f))) for f in (dist.files or []))
        found.append({
            'name': meta['Name'],
            'version': meta['Version'],
            'licenseExpression': meta.get('License-Expression'),
            'license': (meta.get('License') or '').strip().split('\n')[0] or None,
            'classifiers': [c for c in (meta.get_all('Classifier') or []) if c.startswith('License ::')],
            'licenseFiles': licence_files(files),
            'files': files,
        })
    return sorted(found, key=lambda d: d['name'].lower())


def main():
    work, source = sys.argv[1], sys.argv[2]
    print(json.dumps({
        'python': sys.version.split()[0],
        'stdlib': os.path.realpath(sysconfig.get_paths()['stdlib']),
        'base': os.path.realpath(sys.base_prefix),
        'source': os.path.realpath(source),
        'collected': toc_paths(work),
        'distributions': distributions(),
    }))


if __name__ == '__main__':
    main()
