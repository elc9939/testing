import { describe, expect, it } from 'vitest';
import { canAutoSave } from './client-data';

describe('client data sync state', () => {
  it('allows auto-save whenever the browser is online', () => {
    expect(canAutoSave({ isOnline: true })).toBe(true);
    expect(canAutoSave({ isOnline: false })).toBe(false);
  });
});
