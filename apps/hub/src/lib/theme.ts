import { writable } from 'svelte/store';
import { legacyStorageKeys } from '@mini-hub/core';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedThemeMode = 'light' | 'dark';

export function normalizeTheme(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function getSystemTheme(): ResolvedThemeMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(mode: ThemeMode): ResolvedThemeMode {
  return mode === 'system' ? getSystemTheme() : mode;
}

function getThemeStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function readInitialTheme(): ThemeMode {
  const storage = getThemeStorage();
  if (!storage) return 'system';
  try {
    return normalizeTheme(storage.getItem(legacyStorageKeys.theme));
  } catch {
    return 'system';
  }
}

export const theme = writable<ThemeMode>(readInitialTheme());

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = mode;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#111211' : '#f4f4f2');
}

export function setTheme(mode: ThemeMode): void {
  const next = normalizeTheme(mode);
  const storage = getThemeStorage();
  if (storage) {
    try {
      storage.setItem(legacyStorageKeys.theme, next);
    } catch {
      // Theme persistence is best-effort; keep the visible theme switch working.
    }
  }
  theme.set(next);
  applyTheme(next);
}

export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
