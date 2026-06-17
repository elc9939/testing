<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import {
    BarChart3,
    BrainCircuit,
    BriefcaseBusiness,
    CalendarClock,
    Cpu,
    Gamepad2,
    GraduationCap,
    Home,
    Keyboard,
    Settings
  } from 'lucide-svelte';
  import { routeMap } from '@mini-hub/core';
  import { clientData } from '$lib/client-data';
  import { hubHref, hubRouteFromPath } from '$lib/routes';
  import { applyTheme, normalizeTheme, setTheme, theme, watchSystemTheme, type ThemeMode } from '$lib/theme';

  const nav = [
    { href: routeMap.today, label: 'Today', icon: Home },
    { href: routeMap.productivity, label: 'Hub', icon: CalendarClock },
    { href: routeMap.games, label: 'Games', icon: Gamepad2 },
    { href: routeMap.careerDesk, label: 'Career', icon: BriefcaseBusiness },
    { href: routeMap.studyDesk, label: 'Study', icon: GraduationCap },
    { href: routeMap.analytics, label: 'Analytics', icon: BarChart3 },
    { href: routeMap.aiLab, label: 'AI Lab', icon: BrainCircuit },
    { href: routeMap.aiOs, label: 'AI OS', icon: Cpu },
    { href: routeMap.macroLab, label: 'Macros', icon: Keyboard },
    { href: routeMap.settings, label: 'Settings', icon: Settings }
  ];

  $: path = hubRouteFromPath($page.url.pathname);

  onMount(() => {
    let remoteTheme = '';
    let currentTheme: ThemeMode = 'system';
    const unsubscribeTheme = theme.subscribe((nextTheme) => {
      currentTheme = nextTheme;
      applyTheme(nextTheme);
    });
    const unsubscribeSystemTheme = watchSystemTheme(() => applyTheme(currentTheme));
    const unsubscribeData = clientData.subscribe((state) => {
      const nextTheme = state.settings?.theme;
      if (nextTheme && nextTheme !== remoteTheme) {
        remoteTheme = nextTheme;
        setTheme(normalizeTheme(nextTheme));
      }
    });
    applyTheme($theme);
    void clientData.init();
    return () => {
      unsubscribeTheme();
      unsubscribeSystemTheme();
      unsubscribeData();
    };
  });
</script>

<svelte:head>
  <title>Mini Hub</title>
</svelte:head>

<div class="shell">
  <aside class="rail" aria-label="Primary">
    <a class="brand" href={hubHref(routeMap.today)} aria-label="Mini Hub home">
      <span class="brand-mark">MH</span>
      <span>Mini Hub</span>
    </a>
    <div class:offline={$clientData.status === 'offline-readonly'} class="sync-pill">
      {$clientData.status === 'offline-readonly' ? 'Offline read-only' : $clientData.status}
    </div>

    <nav>
      {#each nav as item}
        <a class:active={path === item.href || (item.href !== '/' && path.startsWith(item.href))} href={hubHref(item.href)}>
          <svelte:component this={item.icon} size={18} strokeWidth={1.9} />
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>
  </aside>

  <main>
    <slot />
  </main>
</div>

<style>
  :global(:root) {
    color-scheme: light;
    --bg: #f5f6f8;
    --surface: #ffffff;
    --surface-muted: #f1f4f8;
    --surface-soft: #eaf1fb;
    --text: #18212f;
    --text-soft: #334155;
    --muted: #64748b;
    --border: #dfe5ee;
    --border-strong: #cbd5e1;
    --active: #e8eef6;
    --primary-bg: #2f6feb;
    --primary-text: #ffffff;
    --accent: #2f6feb;
    --code-bg: #0f172a;
    --code-text: #e2e8f0;
    --warning-border: #f2c14e;
    --warning-text: #815d00;
    --warning-bg: #fff8df;
    --error-border: #ff9f6e;
    --error-text: #944700;
    --error-bg: #fff0e6;
    --success-border: #90d4a7;
    --success-text: #166534;
    --success-bg: #ecfdf3;
    --danger-border: #ef4444;
    --danger-text: #9f1239;
    --danger-bg: #fff5f5;
  }

  :global(:root[data-theme='dark']) {
    color-scheme: dark;
    --bg: #0b0f14;
    --surface: #121923;
    --surface-muted: #17202b;
    --surface-soft: #1b2837;
    --text: #eef2f7;
    --text-soft: #cbd5e1;
    --muted: #9aa8b7;
    --border: rgba(226, 232, 240, 0.12);
    --border-strong: rgba(226, 232, 240, 0.22);
    --active: #1f2b39;
    --primary-bg: #8ab4f8;
    --primary-text: #0b0f14;
    --accent: #8ab4f8;
    --code-bg: #070a0f;
    --code-text: #eef2f7;
    --warning-border: #a7812e;
    --warning-text: #f4d58d;
    --warning-bg: #2b2415;
    --error-border: #9f624a;
    --error-text: #ffb395;
    --error-bg: #2d1d18;
    --success-border: #3f8f61;
    --success-text: #9be4b4;
    --success-bg: #14271d;
    --danger-border: #9f4d59;
    --danger-text: #ffb4c0;
    --danger-bg: #2d171d;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    color: var(--text);
    background: var(--bg);
    font-size: 13px;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    font: inherit;
  }

  .shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 224px minmax(0, 1fr);
  }

  .rail {
    position: sticky;
    top: 0;
    height: 100vh;
    padding: 11px 8px;
    border-right: 1px solid var(--border);
    background: var(--surface);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 0 6px 12px;
    color: var(--text);
    font-weight: 650;
    text-decoration: none;
  }

  .brand-mark {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 8px;
    color: var(--primary-text);
    background: var(--primary-bg);
    font-size: 12px;
    letter-spacing: 0;
  }

  nav {
    display: grid;
    gap: 4px;
  }

  .sync-pill {
    margin: 0 6px 12px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
    background: var(--surface-muted);
    font-size: 12px;
    font-weight: 800;
  }

  .sync-pill.offline {
    border-color: var(--warning-border);
    color: var(--warning-text);
    background: var(--warning-bg);
  }

  nav a {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 32px;
    padding: 6px 8px;
    border-radius: 7px;
    color: var(--muted);
    text-decoration: none;
  }

  nav a.active,
  nav a:hover {
    color: var(--text);
    background: var(--active);
  }

  main {
    min-width: 0;
    padding: 14px clamp(12px, 2vw, 22px);
  }

  :global(.page-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    min-height: 46px;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  :global(h1) {
    margin: 0;
    font-size: 17px;
    line-height: 1.2;
    letter-spacing: 0;
    font-weight: 650;
  }

  :global(.eyebrow) {
    margin: 0 0 2px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 540;
    text-transform: none;
    letter-spacing: 0;
  }

  :global(.muted) {
    color: var(--muted);
  }

  :global(.grid) {
    display: grid;
    gap: 10px;
  }

  :global(.grid.three) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  :global(.grid.two) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  :global(.card) {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  :global(.card-pad) {
    padding: 12px;
  }

  :global(.action-row) {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  :global(.button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 30px;
    padding: 5px 9px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    text-decoration: none;
    cursor: pointer;
  }

  :global(.button.primary) {
    border-color: var(--primary-bg);
    color: var(--primary-text);
    background: var(--primary-bg);
  }

  :global(.field) {
    display: grid;
    gap: 6px;
  }

  :global(.field label) {
    color: var(--muted);
    font-size: 13px;
    font-weight: 700;
  }

  :global(input),
  :global(select),
  :global(textarea) {
    width: 100%;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    padding: 8px 10px;
    color: var(--text);
    background: var(--surface);
  }

  :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  :global(th),
  :global(td) {
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }

  :global(th) {
    color: var(--muted);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  @media (max-width: 820px) {
    .shell {
      grid-template-columns: 1fr;
    }

    .rail {
      z-index: 10;
      height: auto;
      padding: 9px;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .brand {
      padding: 4px 6px 10px;
    }

    nav {
      grid-auto-flow: column;
      grid-auto-columns: minmax(86px, 1fr);
      overflow-x: auto;
      padding-bottom: 2px;
    }

    nav a {
      justify-content: center;
      min-height: 34px;
      white-space: nowrap;
    }

    main {
      padding: 14px 12px;
    }

    :global(.page-header) {
      align-items: stretch;
      flex-direction: column;
    }

    :global(.grid.three),
    :global(.grid.two) {
      grid-template-columns: 1fr;
    }
  }
</style>
