import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const routeTitles = [
  ['../routes/+page.svelte', 'Today - Mini Hub'],
  ['../routes/activity/+page.svelte', 'Activity - Mini Hub'],
  ['../routes/productivity/+page.svelte', 'Productivity Hub - Mini Hub'],
  ['../routes/desk/career/+page.svelte', 'Career Desk - Mini Hub'],
  ['../routes/desk/study/+page.svelte', 'Study Desk - Mini Hub'],
  ['../routes/analytics/+page.svelte', 'Analytics - Mini Hub'],
  ['../routes/games/+page.svelte', 'Games - Mini Hub'],
  ['../routes/games/stick-arena-lab/+page.svelte', 'Stick Arena Ability Lab - Mini Hub'],
  ['../routes/research/+page.svelte', 'Research Desk - Mini Hub'],
  ['../routes/ai-lab/+page.svelte', 'AI Lab - Mini Hub'],
  ['../routes/ai-os/+page.svelte', 'AI OS - Mini Hub'],
  ['../routes/macro-lab/+page.svelte', 'Macro Lab - Mini Hub'],
  ['../routes/passive-tasks/+page.svelte', 'Passive Tasks - Mini Hub'],
  ['../routes/settings/+page.svelte', 'Settings - Mini Hub']
] as const;

describe('route document titles', () => {
  it.each(routeTitles)('%s declares %s', (routeFile, expectedTitle) => {
    const file = fileURLToPath(new URL(routeFile, import.meta.url));
    const source = readFileSync(file, 'utf8');
    expect(source).toContain(`<title>${expectedTitle}</title>`);
  });
});
