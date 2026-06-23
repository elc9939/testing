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
    ListChecks,
    Monitor,
    Moon,
    Search,
    Settings,
    Sun
  } from 'lucide-svelte';
  import { routeMap } from '@mini-hub/core';
  import AssistantDock from '$lib/AssistantDock.svelte';
  import { clientData } from '$lib/client-data';
  import { runPassiveEvent } from '$lib/passive-tasks-api';
  import { hubHref, hubRouteFromPath } from '$lib/routes';
  import { applyTheme, normalizeTheme, setTheme, theme, watchSystemTheme, type ThemeMode } from '$lib/theme';

  const nav = [
    { href: routeMap.today, label: 'Today', icon: Home },
    { href: routeMap.productivity, label: 'Hub', icon: CalendarClock },
    { href: routeMap.games, label: 'Games', icon: Gamepad2 },
    { href: routeMap.careerDesk, label: 'Career', icon: BriefcaseBusiness },
    { href: routeMap.studyDesk, label: 'Study', icon: GraduationCap },
    { href: routeMap.analytics, label: 'Analytics', icon: BarChart3 },
    { href: routeMap.research, label: 'Research', icon: Search },
    { href: routeMap.aiLab, label: 'AI Lab', icon: BrainCircuit },
    { href: routeMap.aiOs, label: 'AI OS', icon: Cpu },
    { href: routeMap.macroLab, label: 'Macros', icon: Keyboard },
    { href: routeMap.passiveTasks, label: 'Passive', icon: ListChecks },
    { href: routeMap.settings, label: 'Settings', icon: Settings }
  ];

  $: path = hubRouteFromPath($page.url.pathname);
  $: themeLabel = $theme === 'dark' ? 'Dark' : $theme === 'light' ? 'Light' : 'System';
  const passiveEventThrottlePrefix = 'miniHub.passive.event.v1';

  function cycleTheme(): void {
    const modes: ThemeMode[] = ['system', 'light', 'dark'];
    const currentIndex = modes.indexOf($theme);
    const nextTheme = modes[(currentIndex + 1) % modes.length] ?? 'system';
    setTheme(nextTheme);
    if ($clientData.isOnline) {
      void clientData.saveSettings({ theme: nextTheme }).catch(() => undefined);
    }
  }

  function emitPassiveBrowserEvent(eventName: string, reason: string, throttleMinutes: number): void {
    if (typeof window === 'undefined' || !navigator.onLine) return;
    const key = `${passiveEventThrottlePrefix}.${eventName}`;
    const lastRun = Number(localStorage.getItem(key) ?? '0');
    if (Number.isFinite(lastRun) && Date.now() - lastRun < throttleMinutes * 60_000) return;
    void runPassiveEvent(eventName, { reason, limit: 1 })
      .then(() => localStorage.setItem(key, String(Date.now())))
      .catch(() => undefined);
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
    void clientData.init().then(() => emitPassiveBrowserEvent('app.startup', 'hub-layout-startup', 30));
    const handleOnline = () => emitPassiveBrowserEvent('app.reconnect', 'browser-online', 10);
    window.addEventListener('online', handleOnline);
    return () => {
      unsubscribeTheme();
      unsubscribeSystemTheme();
      unsubscribeData();
      window.removeEventListener('online', handleOnline);
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

  <AssistantDock />
</div>

<style>
  :global(:root) {
    color-scheme: light;
    --bg: #f4f4f2;
    --surface: #ffffff;
    --surface-muted: #eeeeeb;
    --surface-soft: #e5e5e1;
    --text: #20211f;
    --text-soft: #3e403c;
    --muted: #6c6e68;
    --border: #d8d8d2;
    --border-strong: #bfc0b8;
    --active: #e7e7e2;
    --primary-bg: #303331;
    --primary-text: #ffffff;
    --accent: #555a56;
    --code-bg: #111312;
    --code-text: #f2f2ee;
    --warning-border: #d7a12a;
    --warning-text: #6c4c00;
    --warning-bg: #fff7dd;
    --error-border: #dd7660;
    --error-text: #8e3428;
    --error-bg: #fff1ec;
    --success-border: #74b89a;
    --success-text: #0f6348;
    --success-bg: #effaf5;
    --danger-border: #dc4361;
    --danger-text: #941833;
    --danger-bg: #fff0f4;
  }

  :global(:root[data-theme='dark']) {
    color-scheme: dark;
    --bg: #111211;
    --surface: #181918;
    --surface-muted: #222321;
    --surface-soft: #2b2c2a;
    --text: #f1f1ed;
    --text-soft: #d6d6cf;
    --muted: #a8aaa1;
    --border: #343631;
    --border-strong: #4a4d45;
    --active: #2f302d;
    --primary-bg: #e4e4dd;
    --primary-text: #151613;
    --accent: #d0d0c8;
    --code-bg: #090a09;
    --code-text: #f1f1ed;
    --warning-border: #a68133;
    --warning-text: #efd18a;
    --warning-bg: #2a2415;
    --error-border: #a86155;
    --error-text: #ffc2b8;
    --error-bg: #2d1b1a;
    --success-border: #528a73;
    --success-text: #9fdabc;
    --success-bg: #15251f;
    --danger-border: #a94f65;
    --danger-text: #ffc0cd;
    --danger-bg: #301821;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    overflow-x: hidden;
    color: var(--text);
    background: var(--bg);
    font-size: 13px;
    font-family:
      "Segoe UI Variable Text", "Segoe UI", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  }

  :global(html) {
    overflow-x: hidden;
    background: var(--bg);
  }

  :global(img),
  :global(canvas),
  :global(video),
  :global(svg) {
    max-width: 100%;
  }

  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    font: inherit;
    color: var(--text);
  }

  :global(button),
  :global(input),
  :global(select),
  :global(textarea),
  :global(progress) {
    accent-color: var(--accent);
  }

  :global(option) {
    color: var(--text);
    background: var(--surface);
  }

  :global(input:disabled),
  :global(select:disabled),
  :global(textarea:disabled) {
    color: var(--muted);
    background: var(--surface-muted);
    opacity: 1;
  }

  :global(button:disabled) {
    opacity: 0.6;
  }

  :global(input:-webkit-autofill),
  :global(textarea:-webkit-autofill),
  :global(select:-webkit-autofill) {
    box-shadow: 0 0 0 1000px var(--surface) inset;
    -webkit-text-fill-color: var(--text);
    caret-color: var(--text);
  }

  :global(::selection) {
    color: var(--text);
    background: var(--active);
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
    overflow-x: hidden;
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
      display: block;
      padding-bottom: 76px;
    }

    .rail {
      position: fixed;
      inset: auto 0 0;
      z-index: 60;
      height: auto;
      padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
      border-top: 1px solid var(--border);
      border-right: 0;
      border-bottom: 0;
      box-shadow: 0 -10px 24px rgb(0 0 0 / 12%);
    }

    .brand,
    .sync-pill,
    .theme-cycle {
      display: none;
    }

    nav {
      grid-auto-flow: column;
      grid-auto-columns: minmax(64px, 1fr);
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
    }

    nav::-webkit-scrollbar {
      display: none;
    }

    nav a {
      flex-direction: column;
      justify-content: center;
      gap: 3px;
      min-height: 56px;
      padding: 6px 8px;
      font-size: 11px;
      white-space: nowrap;
    }

    main {
      width: 100%;
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

    :global(.button) {
      min-height: 40px;
      padding: 7px 10px;
    }

    :global(input),
    :global(select),
    :global(textarea) {
      min-height: 40px;
      font-size: 16px;
    }

    :global(.table-card) {
      max-width: calc(100vw - 20px);
      overflow-x: auto;
    }
  }
</style>
