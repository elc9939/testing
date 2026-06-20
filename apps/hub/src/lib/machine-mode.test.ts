import { describe, expect, it } from 'vitest';
import {
  formatMachineModeContext,
  machineModeContext,
  machineModeFromPreferences,
  machineModePreferenceKey,
  normalizeMachineMode
} from './machine-mode';

describe('machine modes', () => {
  it('defaults safely to balanced when no preference is set', () => {
    expect(normalizeMachineMode(undefined)).toBe('balanced');
    expect(normalizeMachineMode('unknown')).toBe('balanced');
    expect(machineModeFromPreferences({}).id).toBe('balanced');
  });

  it('reads a saved mode from settings preferences', () => {
    expect(machineModeFromPreferences({ [machineModePreferenceKey]: 'beast' }).id).toBe('beast');
    expect(machineModeFromPreferences({ [machineModePreferenceKey]: 'offline' }).label).toBe('Offline Mode');
    expect(machineModeFromPreferences({ [machineModePreferenceKey]: 'night' }).label).toBe('Night Shift');
  });

  it('produces assistant and AI OS command context', () => {
    const offline = machineModeContext('offline');
    const summary = formatMachineModeContext(machineModeFromPreferences({ [machineModePreferenceKey]: 'maintenance' }));

    expect(offline.cost).toContain('Never use paid/API fallback');
    expect(offline.constraints.length).toBeGreaterThan(2);
    expect(summary).toContain('Machine mode: Maintenance Mode.');
  });
});
