<script lang="ts">
  import { onMount } from 'svelte';
  import { exchangeGoogleOAuthCode, type GoogleOAuthExchangeResult } from '$lib/productivity-api';
  import { hubHref } from '$lib/routes';

  let title = 'Finishing Google connection';
  let detail = 'Mini Hub is saving the Google OAuth grant through your local API.';

  function fallbackRedirectUrl(status: string, message?: string): string {
    const target = new URL(hubHref('/productivity'), window.location.origin);
    target.searchParams.set('google', status);
    if (message) target.searchParams.set('message', message);
    return target.toString();
  }

  function failureResult(message: string, status = 'error'): GoogleOAuthExchangeResult {
    return {
      ok: false,
      status,
      message,
      redirectUrl: fallbackRedirectUrl(status, message)
    };
  }

  function finish(result: GoogleOAuthExchangeResult): void {
    const redirectUrl = result.redirectUrl || fallbackRedirectUrl(result.status, result.message);
    const message = {
      type: 'mini-hub:google-oauth',
      provider: 'google',
      status: result.status,
      message: result.message ?? '',
      redirectUrl
    };
    const targetOrigin = new URL(redirectUrl).origin;

    title = result.ok ? 'Google connected' : 'Google connection needs attention';
    detail = result.ok ? 'Returning to Mini Hub...' : result.message || 'Returning to Mini Hub with the error details.';

    if (window.opener && !window.opener.closed) {
      let attempts = 0;
      let timer: number | undefined;
      const notify = () => {
        attempts += 1;
        window.opener.postMessage(message, targetOrigin);
        if (attempts >= 12 && timer !== undefined) window.clearInterval(timer);
      };
      timer = window.setInterval(notify, 250);
      notify();
      window.setTimeout(() => window.close(), 600);
      return;
    }

    window.location.replace(redirectUrl);
  }

  onMount(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const oauthError = params.get('error');
      const oauthErrorDescription = params.get('error_description');
      const code = params.get('code');
      const state = params.get('state');

      if (oauthError) {
        finish(failureResult(oauthErrorDescription || oauthError));
        return;
      }

      if (!code || !state) {
        finish(failureResult('Google OAuth did not return a usable authorization code.', 'missing-code'));
        return;
      }

      try {
        finish(await exchangeGoogleOAuthCode({ code, state }));
      } catch (error) {
        finish(failureResult(error instanceof Error ? error.message : 'Google OAuth failed.'));
      }
    })();
  });
</script>

<svelte:head>
  <title>Google OAuth - Mini Hub</title>
</svelte:head>

<main class="oauth-callback" aria-live="polite">
  <section>
    <strong>{title}</strong>
    <p>{detail}</p>
  </section>
</main>

<style>
  .oauth-callback {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg);
    color: var(--text);
  }

  .oauth-callback section {
    width: min(34rem, 100%);
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    padding: 18px;
    box-shadow: var(--shadow-sm);
  }

  .oauth-callback strong {
    display: block;
    font-size: 16px;
  }

  .oauth-callback p {
    margin: 8px 0 0;
    color: var(--muted);
  }
</style>
