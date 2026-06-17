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
    Monitor,
    Moon,
    Settings,
    Sun
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
  $: themeLabel = $theme === 'dark' ? 'Dark' : $theme === 'light' ? 'Light' : 'System';

  function cycleTheme(): void {
    const modes: ThemeMode[] = ['system', 'light', 'dark'];
    const currentIndex = modes.indexOf($theme);
    const nextTheme = modes[(currentIndex + 1) % modes.length] ?? 'system';
    setTheme(nextTheme);
    if ($clientData.isOnline) {
      void clientData.saveSettings({ theme: nextTheme }).catch(() => undefined);
    }
  }

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
    <button class="theme-cycle" type="button" aria-label={`Theme: ${themeLabel}. Change theme`} on:click={cycleTheme}>
      {#if $theme === 'dark'}
        <Moon size={15} />
      {:else if $theme === 'light'}
        <Sun size={15} />
      {:else}
        <Monitor size={15} />
      {/if}
      <span>{themeLabel}</span>
    </button>

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
    --bg: #efefec;
    --surface: #ffffff;
    --surface-muted: #f0efeb;
    --surface-soft: #e9e6df;
    --text: #24211d;
    --text-soft: #423c37;
    --muted: #68615b;
    --border: #d9d5ce;
    --border-strong: #c7c1b8;
    --active: #e9e6df;
    --primary-bg: #9b653b;
    --primary-text: #ffffff;
    --accent: #9b653b;
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
    --bg: #151413;
    --surface: #222120;
    --surface-muted: #1d1c1b;
    --surface-soft: #242321;
    --text: #ebe6dc;
    --text-soft: #d3cbc1;
    --muted: #aaa29a;
    --border: #35312d;
    --border-strong: #48423c;
    --active: #2b2927;
    --primary-bg: #c27c45;
    --primary-text: #151413;
    --accent: #c27c45;
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
      "Segoe UI Variable Text", "Segoe UI", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
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
    grid-template-columns: 218px minmax(0, 1fr);
  }

  .rail {
    position: sticky;
    top: 0;
    height: 100vh;
    padding: 10px 8px;
    border-right: 1px solid var(--border);
    background: var(--surface);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 32px;
    padding: 0 6px 8px;
    color: var(--text);
    font-weight: 650;
    text-decoration: none;
  }

  .brand-mark {
    display: grid;
    width: 30px;
    height: 30px;
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
    margin: 0 6px 8px;
    padding: 5px 7px;
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

  .theme-cycle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: calc(100% - 12px);
    min-height: 30px;
    margin: 0 6px 10px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
    background: var(--surface-muted);
    cursor: pointer;
  }

  .theme-cycle:hover {
    color: var(--text);
    background: var(--active);
  }

  nav a {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 30px;
    padding: 5px 8px;
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
    padding: 10px clamp(10px, 1.8vw, 18px);
  }

  :global(.page-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 34px;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  :global(h1) {
    margin: 0;
    font-size: 15px;
    line-height: 1.2;
    letter-spacing: 0;
    font-weight: 650;
  }

  :global(.eyebrow) {
    margin: 0 0 1px;
    color: var(--muted);
    font-size: 11px;
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
    min-height: 28px;
    padding: 4px 8px;
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
    padding: 7px 9px;
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
    padding: 8px 9px;
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
      padding: 8px;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }

    .brand {
      padding: 2px 6px 8px;
    }

    nav {
      grid-auto-flow: column;
      grid-auto-columns: minmax(82px, 1fr);
      overflow-x: auto;
      padding-bottom: 2px;
    }

    nav a {
      justify-content: center;
      min-height: 32px;
      white-space: nowrap;
    }

    main {
      padding: 10px 10px;
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
