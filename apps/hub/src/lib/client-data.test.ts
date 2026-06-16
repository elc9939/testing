import { describe, expect, it } from 'vitest';
import { canAutoSave } from './client-data';

describe('client data sync state', () => {
  it('allows auto-save only when online with a sync key', () => {
    expect(canAutoSave({ isOnline: true, syncKey: 'secret' })).toBe(true);
    expect(canAutoSave({ isOnline: false, syncKey: 'secret' })).toBe(false);
    expect(canAutoSave({ isOnline: true, syncKey: '' })).toBe(false);
  });
});

