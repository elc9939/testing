<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { hubHref } from '$lib/routes';

  $: targetHref = hubHref(`/passive-tasks${$page.url.search}${$page.url.hash}`);

  onMount(() => {
    void goto(targetHref, { replaceState: true });
  });
</script>

<svelte:head>
  <title>Passive Tasks - Mini Hub</title>
</svelte:head>

<section class="redirect-shell" aria-label="Passive Tasks route alias">
  <h1>Passive Tasks</h1>
  <p>Opening the background work dashboard.</p>
  <a class="button compact" href={targetHref} title="Open the Passive Tasks dashboard.">Open Passive Tasks</a>
</section>

