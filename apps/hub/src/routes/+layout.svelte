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

  $: path = $page.url.pathname;

  onMount(() => {
    void clientData.init();
  });
</script>

<svelte:head>
  <title>Mini Hub</title>
</svelte:head>

<div class="shell">
  <aside class="rail" aria-label="Primary">
    <a class="brand" href={routeMap.today} aria-label="Mini Hub home">
      <span class="brand-mark">MH</span>
      <span>Mini Hub</span>
    </a>
    <div class:offline={$clientData.status === 'offline-readonly'} class:missing={$clientData.status === 'missing-key'} class="sync-pill">
      {$clientData.status === 'offline-readonly' ? 'Offline read-only' : $clientData.status === 'missing-key' ? 'Sync key needed' : $clientData.status}
    </div>

    <nav>
      {#each nav as item}
        <a class:active={path === item.href || (item.href !== '/' && path.startsWith(item.href))} href={item.href}>
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
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    color: #18202f;
    background: #f6f8fb;
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
    padding: 18px 14px;
    border-right: 1px solid #dfe5ee;
    background: #ffffff;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px 18px;
    color: #18202f;
    font-weight: 800;
    text-decoration: none;
  }

  .brand-mark {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 8px;
    color: #ffffff;
    background: #18202f;
    font-size: 12px;
    letter-spacing: 0;
  }

  nav {
    display: grid;
    gap: 4px;
  }

  .sync-pill {
    margin: 0 10px 14px;
    padding: 7px 8px;
    border: 1px solid #dfe5ee;
    border-radius: 6px;
    color: #475569;
    background: #f8fafc;
    font-size: 12px;
    font-weight: 800;
  }

  .sync-pill.offline {
    border-color: #f2c14e;
    color: #815d00;
    background: #fff8df;
  }

  .sync-pill.missing {
    border-color: #ff9f6e;
    color: #944700;
    background: #fff0e6;
  }

  nav a {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 9px 10px;
    border-radius: 7px;
    color: #475569;
    text-decoration: none;
  }

  nav a.active,
  nav a:hover {
    color: #18202f;
    background: #edf3f8;
  }

  main {
    min-width: 0;
    padding: 28px clamp(18px, 3vw, 42px);
  }

  :global(.page-header) {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 22px;
  }

  :global(h1) {
    margin: 0;
    font-size: clamp(28px, 4vw, 42px);
    line-height: 1;
    letter-spacing: 0;
  }

  :global(.eyebrow) {
    margin: 0 0 7px;
    color: #64748b;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  :global(.muted) {
    color: #64748b;
  }

  :global(.grid) {
    display: grid;
    gap: 14px;
  }

  :global(.grid.three) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  :global(.grid.two) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  :global(.card) {
    border: 1px solid #dfe5ee;
    border-radius: 8px;
    background: #ffffff;
  }

  :global(.card-pad) {
    padding: 18px;
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
    min-height: 38px;
    padding: 8px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    color: #18202f;
    background: #ffffff;
    text-decoration: none;
    cursor: pointer;
  }

  :global(.button.primary) {
    border-color: #18202f;
    color: #ffffff;
    background: #18202f;
  }

  :global(.field) {
    display: grid;
    gap: 6px;
  }

  :global(.field label) {
    color: #475569;
    font-size: 13px;
    font-weight: 700;
  }

  :global(input),
  :global(select),
  :global(textarea) {
    width: 100%;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 10px 11px;
    color: #18202f;
    background: #ffffff;
  }

  :global(table) {
    width: 100%;
    border-collapse: collapse;
  }

  :global(th),
  :global(td) {
    padding: 11px 10px;
    border-bottom: 1px solid #e5eaf1;
    text-align: left;
    vertical-align: top;
  }

  :global(th) {
    color: #64748b;
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
      padding: 10px;
      border-right: 0;
      border-bottom: 1px solid #dfe5ee;
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
      min-height: 38px;
      white-space: nowrap;
    }

    main {
      padding: 20px 14px;
    }

    :global(.page-header) {
      align-items: flex-start;
      flex-direction: column;
    }

    :global(.grid.three),
    :global(.grid.two) {
      grid-template-columns: 1fr;
    }
  }
</style>
