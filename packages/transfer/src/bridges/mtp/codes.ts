// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** PTP/MTP codes the initiator accepts. Still image is class 6, subclass 1, protocol 1. */

export const TYPE_COMMAND = 1;
export const TYPE_DATA = 2;
export const TYPE_RESPONSE = 3;

export const OP_OPEN_SESSION = 0x1002;
export const OP_CLOSE_SESSION = 0x1003;
export const OP_GET_STORAGE_IDS = 0x1004;
export const OP_GET_OBJECT_HANDLES = 0x1007;
export const OP_GET_OBJECT_INFO = 0x1008;
export const OP_GET_THUMB = 0x100a;
export const OP_GET_PARTIAL_OBJECT = 0x101b;
export const OP_GET_PARTIAL_OBJECT_64 = 0x95c1;
/** MTP 1.1: one property of one object. Required of every MTP responder. */
export const OP_GET_OBJECT_PROP_VALUE = 0x9803;
/** MTP 1.1: properties of objects in one dataset. Optional; many Android phones have it. */
export const OP_GET_OBJECT_PROP_LIST = 0x9805;

export const RES_OK = 0x2001;
export const RES_OPERATION_NOT_SUPPORTED = 0x2005;
export const RES_SESSION_ALREADY_OPEN = 0x201e;

/** ObjectSize, UINT64: the real size when ObjectInfo's 32-bit field says 0xFFFFFFFF. */
export const PROP_OBJECT_SIZE = 0xdc04;
export const DATATYPE_UINT64 = 0x0008;
/** ObjectInfo's ObjectCompressedSize for an object of 4 GiB or more. */
export const SIZE_32_UNKNOWN = 0xffff_ffff;
export const FOUR_GIB = 0x1_0000_0000;

export const FORMAT_ASSOCIATION = 0x3001;
export const CHUNK_BYTES = 1024 * 1024;

const MEDIA = new Map<number, { readonly kind: 'image' | 'video'; readonly type: string }>([
  [0x3801, { kind: 'image', type: 'image/jpeg' }],
  [0x3802, { kind: 'image', type: 'image/tiff' }],
  [0x3804, { kind: 'image', type: 'image/bmp' }],
  [0x3807, { kind: 'image', type: 'image/gif' }],
  [0x3808, { kind: 'image', type: 'image/jpeg' }],
  [0x380b, { kind: 'image', type: 'image/png' }],
  [0x380d, { kind: 'image', type: 'image/tiff' }],
  [0x3812, { kind: 'image', type: 'image/heif' }],
  [0x300a, { kind: 'video', type: 'video/avi' }],
  [0x300b, { kind: 'video', type: 'video/mpeg' }],
  [0x300d, { kind: 'video', type: 'video/quicktime' }],
  [0xb982, { kind: 'video', type: 'video/mp4' }],
  [0xb984, { kind: 'video', type: 'video/3gpp' }],
]);

const ROOTS = new Set(['dcim', 'pictures', 'movies']);

export function mediaOf(format: number): { readonly kind: 'image' | 'video'; readonly type: string } | null {
  return MEDIA.get(format) ?? null;
}

export function isMediaRoot(name: string): boolean {
  return ROOTS.has(name.trim().toLowerCase());
}

/** Android MediaStore thumbnail caches and trash directories inside DCIM/Pictures/Movies. */
export function isIgnoredFolder(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    lower === '.thumbnails' ||
    lower === '.trash' ||
    lower === '.trashed' ||
    lower.startsWith('.trashed-')
  );
}

/** Four hex digits. A response code, never a path or a serial. */
export function responseCode(code: number): string {
  return code.toString(16).padStart(4, '0');
}
