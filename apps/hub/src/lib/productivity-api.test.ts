import { describe, expect, it, vi, afterEach } from 'vitest';

const requestApiJsonWithTimeoutMock = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  requestApiJsonWithTimeout: requestApiJsonWithTimeoutMock
}));

import {
  getGoogleOAuthUrl,
  listEvents,
  markGmailThreadRead,
  productivityActionTimeoutMs,
  productivityOAuthTimeoutMs,
  productivityReadTimeoutMs,
  sendGmailMessage
} from './productivity-api';

describe('productivity API request bounds', () => {
  afterEach(() => {
    requestApiJsonWithTimeoutMock.mockReset();
  });

  it('uses a short read timeout for calendar queries', async () => {
    requestApiJsonWithTimeoutMock.mockResolvedValue({ events: [] });

    await listEvents({
      calendarId: 'primary',
      timeMin: '2026-06-23T00:00:00.000Z',
      timeMax: '2026-06-30T00:00:00.000Z',
      q: 'exam'
    });

    expect(requestApiJsonWithTimeoutMock).toHaveBeenCalledWith(
      '/api/productivity/calendar/events?calendarId=primary&timeMin=2026-06-23T00%3A00%3A00.000Z&timeMax=2026-06-30T00%3A00%3A00.000Z&q=exam',
      {},
      productivityReadTimeoutMs
    );
  });

  it('uses a bounded OAuth timeout for connection startup', async () => {
    requestApiJsonWithTimeoutMock.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth' });

    await getGoogleOAuthUrl('https://elc9939.github.io/testing/productivity', 'popup', 'hub');

    expect(requestApiJsonWithTimeoutMock).toHaveBeenCalledWith(
      '/api/integrations/google/oauth/start?returnTo=https%3A%2F%2Felc9939.github.io%2Ftesting%2Fproductivity&mode=popup&callback=hub',
      { headers: { 'X-Mini-Hub-Return-To': 'https://elc9939.github.io/testing/productivity' } },
      productivityOAuthTimeoutMs
    );
  });

  it('uses a longer action timeout for sends and Gmail state changes', async () => {
    requestApiJsonWithTimeoutMock
      .mockResolvedValueOnce({ message: { id: 'msg_1' } })
      .mockResolvedValueOnce({ thread: { id: 'thread_1' } });

    await sendGmailMessage({
      to: ['edward@example.com'],
      subject: 'Hello',
      bodyText: 'Body'
    });
    await markGmailThreadRead('thread_1');

    expect(requestApiJsonWithTimeoutMock).toHaveBeenNthCalledWith(
      1,
      '/api/productivity/gmail/messages/send',
      { method: 'POST', body: JSON.stringify({ to: ['edward@example.com'], subject: 'Hello', bodyText: 'Body' }) },
      productivityActionTimeoutMs
    );
    expect(requestApiJsonWithTimeoutMock).toHaveBeenNthCalledWith(
      2,
      '/api/productivity/gmail/threads/thread_1/read',
      { method: 'POST' },
      productivityActionTimeoutMs
    );
  });
});
