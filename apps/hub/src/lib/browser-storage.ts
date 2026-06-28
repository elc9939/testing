export type BrowserStorageKind = 'local' | 'session';

export function getBrowserStorage(kind: BrowserStorageKind = 'local'): Storage | null {
  try {
    return kind === 'session'
      ? typeof globalThis.sessionStorage === 'undefined'
        ? null
        : globalThis.sessionStorage
      : typeof globalThis.localStorage === 'undefined'
        ? null
        : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function canUseBrowserStorage(kind: BrowserStorageKind = 'local'): boolean {
  const storage = getBrowserStorage(kind);
  if (!storage) return false;
  const key = `miniHub.storageCheck.${kind}`;
  try {
    storage.setItem(key, '1');
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
