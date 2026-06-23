import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './request-timeout';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the original promise result before the timeout fires', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 'quick request', 50)).resolves.toBe('ok');
  });

  it('rejects hung work with an actionable timeout message', async () => {
    vi.useFakeTimers();
    const result = withTimeout(new Promise<string>(() => undefined), 'Today attention refresh', 25);
    const assertion = expect(result).rejects.toThrow('Today attention refresh timed out after 25 ms.');

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });
});
