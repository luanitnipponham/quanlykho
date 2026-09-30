// File naming and storage paths (workflow §8.3):
//   /CHUNG_TU/{CUNG_UNG|KE_TOAN}/{YYYY-MM-DD}/{MA_PHIEU}/{file_name}
// No DOCUMENT/IMAGE split — documents and images share the request's folder.
import { toDateKey } from './dates.ts';
import { fail } from './errors.ts';
import type { StorageFolder, SystemConfig } from './types.ts';

export const STORAGE_ROOT = 'CHUNG_TU';

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** Strip Vietnamese diacritics and replace anything outside [A-Za-z0-9_-] with "_". */
export function normalizeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function folderOfDate(at: Date): string {
  return toDateKey(at);
}

/**
 * Normalized file name for storage. `taken` holds the names already used in the same
 * request folder for that day; a clash gets an `_{HHmmss}` suffix (workflow §8.3).
 */
export function buildFileName(originalName: string, at: Date, taken: Iterable<string> = []): string {
  const ext = fileExtension(originalName);
  const rawBase = ext ? originalName.slice(0, -(ext.length + 1)) : originalName;
  const base = normalizeFileName(rawBase) || 'file';
  const withExt = (b: string) => (ext ? `${b}.${ext}` : b);
  const used = new Set(taken);
  if (!used.has(withExt(base))) return withExt(base);
  const stamp = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  let candidate = withExt(`${base}_${stamp}`);
  let n = 2;
  while (used.has(candidate)) candidate = withExt(`${base}_${stamp}_${n++}`);
  return candidate;
}

export function buildStoragePath(folder: StorageFolder, requestCode: string, fileName: string, at: Date): string {
  return `/${STORAGE_ROOT}/${folder}/${folderOfDate(at)}/${requestCode}/${fileName}`;
}

/** Folder that holds every file of one request uploaded by one department on one day. */
export function requestFolder(folder: StorageFolder, requestCode: string, at: Date): string {
  return `/${STORAGE_ROOT}/${folder}/${folderOfDate(at)}/${requestCode}`;
}

export function validateUpload(name: string, size: number, config: SystemConfig): void {
  const ext = fileExtension(name);
  if (!config.allowedExtensions.includes(ext)) {
    fail('ERR_FILE_TYPE', `Định dạng .${ext || '?'} không được phép. Cho phép: ${config.allowedExtensions.join(', ')}`);
  }
  const limit = config.maxFileSizeMb * 1024 * 1024;
  if (size > limit) {
    const mb = (size / 1024 / 1024).toFixed(1);
    fail('ERR_FILE_TOO_LARGE', `File "${name}" nặng ${mb} MB, vượt giới hạn ${config.maxFileSizeMb} MB`);
  }
}
