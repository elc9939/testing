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

function readInitialTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  return normalizeTheme(localStorage.getItem(legacyStorageKeys.theme));
}

export const theme = writable<ThemeMode>(readInitialTheme());

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = mode;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#11131d' : '#f4f6fb');
}

export function setTheme(mode: ThemeMode): void {
  const next = normalizeTheme(mode);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(legacyStorageKeys.theme, next);
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
