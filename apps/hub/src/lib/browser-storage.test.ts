import { afterEach, describe, expect, it, vi } from 'vitest';
import { canUseBrowserStorage, getBrowserStorage } from './browser-storage';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

describe('browser storage helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns usable storage when the browser storage object is writable', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);

    expect(getBrowserStorage()).toBe(storage);
    expect(canUseBrowserStorage()).toBe(true);
  });

  it('returns null when browser storage access is blocked', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('Browser storage blocked');
      }
    });

    expect(getBrowserStorage()).toBeNull();
    expect(canUseBrowserStorage()).toBe(false);
  });
});
