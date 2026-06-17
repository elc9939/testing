import { writable } from 'svelte/store';
import { legacyStorageKeys } from '@mini-hub/core';

export type ThemeMode = 'light' | 'dark';

export function normalizeTheme(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light';
}

function readInitialTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'light';
  return normalizeTheme(localStorage.getItem(legacyStorageKeys.theme));
}

export const theme = writable<ThemeMode>(readInitialTheme());

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#151413' : '#f7f7f4');
}

export function setTheme(mode: ThemeMode): void {
  const next = normalizeTheme(mode);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(legacyStorageKeys.theme, next);
  }
  theme.set(next);
  applyTheme(next);
}
