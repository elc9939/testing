import { legacyStorageKeys } from '@mini-hub/core';

export interface LegacyImportSummary {
  careers: number;
  studyDays: number;
  highScoreGames: number;
  hasTheme: boolean;
  hasStickArenaMap: boolean;
  warnings: string[];
}

type ReadableStorage = Pick<Storage, 'getItem'>;

function readJson(storage: ReadableStorage, key: string): unknown {
  const raw = storage.getItem(key);
  if (!raw) return undefined;
  return JSON.parse(raw) as unknown;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function countObjectKeys(value: unknown): number {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).length
    : 0;
}

export function inspectLegacyStorage(storage: ReadableStorage): LegacyImportSummary {
  const warnings: string[] = [];
  let careers = 0;
  let studyDays = 0;
  let highScoreGames = 0;

  try {
    careers = countArray(readJson(storage, legacyStorageKeys.careerJobs));
  } catch {
    warnings.push('Career Desk data exists but could not be parsed.');
  }

  try {
    const study = readJson(storage, legacyStorageKeys.studyState);
    studyDays = countObjectKeys((study as { days?: unknown } | undefined)?.days);
  } catch {
    warnings.push('Study Desk data exists but could not be parsed.');
  }

  try {
    highScoreGames = countObjectKeys(readJson(storage, legacyStorageKeys.highScores));
  } catch {
    warnings.push('High-score data exists but could not be parsed.');
  }

  return {
    careers,
    studyDays,
    highScoreGames,
    hasTheme: Boolean(storage.getItem(legacyStorageKeys.theme)),
    hasStickArenaMap: Boolean(storage.getItem(legacyStorageKeys.stickArenaMap)),
    warnings
  };
}

export function exportLegacySnapshot(storage: ReadableStorage): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const key of Object.values(legacyStorageKeys)) {
    const value = storage.getItem(key);
    if (value) snapshot[key] = value;
  }
  return snapshot;
}

