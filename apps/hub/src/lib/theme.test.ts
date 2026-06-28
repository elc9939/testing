import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

class ThrowingStorage implements Storage {
  get length(): number {
    throw new Error('Browser storage blocked');
  }

  clear(): void {
    throw new Error('Browser storage blocked');
  }

  getItem(): string | null {
    throw new Error('Browser storage blocked');
  }

  key(): string | null {
    throw new Error('Browser storage blocked');
  }

  removeItem(): void {
    throw new Error('Browser storage blocked');
  }

  setItem(): void {
    throw new Error('Browser storage blocked');
  }
}

describe('theme storage resilience', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('keeps theme import and toggles usable when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', new ThrowingStorage());
    vi.resetModules();

    const { setTheme, theme } = await import('./theme');

    expect(get(theme)).toBe('system');
    expect(() => setTheme('dark')).not.toThrow();
    expect(get(theme)).toBe('dark');
  });
});
