import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const routeTitles = [
  ['../routes/+page.svelte', 'Today - Mini Hub'],
  ['../routes/activity/+page.svelte', 'Activity - Mini Hub'],
  ['../routes/productivity/+page.svelte', 'Productivity Hub - Mini Hub'],
  ['../routes/oauth/google/callback/+page.svelte', 'Google OAuth - Mini Hub'],
  ['../routes/desk/career/+page.svelte', 'Career Desk - Mini Hub'],
  ['../routes/desk/study/+page.svelte', 'Study Desk - Mini Hub'],
  ['../routes/analytics/+page.svelte', 'Analytics - Mini Hub'],
  ['../routes/games/+page.svelte', 'Games - Mini Hub'],
  ['../routes/games/stick-arena-lab/+page.svelte', 'Stick Arena Ability Lab - Mini Hub'],
  ['../routes/research/+page.svelte', 'Research Desk - Mini Hub'],
  ['../routes/ai-lab/+page.svelte', 'AI Lab - Mini Hub'],
  ['../routes/ai-os/+page.svelte', 'AI OS - Mini Hub'],
  ['../routes/macro-lab/+page.svelte', 'Macro Lab - Mini Hub'],
  ['../routes/passive/+page.svelte', 'Passive Tasks - Mini Hub'],
  ['../routes/passive-tasks/+page.svelte', 'Passive Tasks - Mini Hub'],
  ['../routes/settings/+page.svelte', 'Settings - Mini Hub']
] as const;

const routeHeadings = [
  ['../routes/+page.svelte', '<h1>Attention Queue</h1>'],
  ['../routes/activity/+page.svelte', '<h1>Activity</h1>'],
  ['../routes/productivity/+page.svelte', '<h1>Productivity Hub</h1>'],
  ['../routes/oauth/google/callback/+page.svelte', '<h1>Google OAuth</h1>'],
  ['../routes/desk/career/+page.svelte', '<h1>Career</h1>'],
  ['../routes/desk/study/+page.svelte', '<h1>Study</h1>'],
  ['../routes/analytics/+page.svelte', '<h1>Local Insights</h1>'],
  ['../routes/games/+page.svelte', '<h1>Play Surfaces</h1>'],
  ['../routes/games/stick-arena-lab/+page.svelte', '<h1>Ability Lab</h1>'],
  ['../routes/research/+page.svelte', '<h1>Research Desk</h1>'],
  ['../routes/ai-lab/+page.svelte', '<h1>Browser Experiments</h1>'],
  ['../routes/ai-os/+page.svelte', '<h1>Ask AI OS</h1>'],
  ['../routes/macro-lab/+page.svelte', '<h1>Macro Lab</h1>'],
  ['../routes/passive/+page.svelte', '<h1>Passive Tasks</h1>'],
  ['../routes/passive-tasks/+page.svelte', '<h1>Passive Tasks</h1>'],
  ['../routes/settings/+page.svelte', '<h1>Settings</h1>']
] as const;

describe('route document titles', () => {
  it.each(routeTitles)('%s declares %s', (routeFile, expectedTitle) => {
    const file = fileURLToPath(new URL(routeFile, import.meta.url));
    const source = readFileSync(file, 'utf8');
    expect(source).toContain(`<title>${expectedTitle}</title>`);
  });

  it.each(routeHeadings)('%s declares visible heading %s', (routeFile, expectedHeading) => {
    const file = fileURLToPath(new URL(routeFile, import.meta.url));
    const source = readFileSync(file, 'utf8');
    expect(source).toContain(expectedHeading);
  });

  it('keeps primary nav labels wired to the matching route map entries', () => {
    const file = fileURLToPath(new URL('../routes/+layout.svelte', import.meta.url));
    const source = readFileSync(file, 'utf8');

    for (const expectedNav of [
      "href: routeMap.today, label: 'Today'",
      "href: routeMap.activity, label: 'Activity'",
      "href: routeMap.productivity, label: 'Hub'",
      "href: routeMap.games, label: 'Games'",
      "href: routeMap.careerDesk, label: 'Career'",
      "href: routeMap.studyDesk, label: 'Study'",
      "href: routeMap.analytics, label: 'Analytics'",
      "href: routeMap.research, label: 'Research'",
      "href: routeMap.aiLab, label: 'AI Lab'",
      "href: routeMap.aiOs, label: 'AI OS'",
      "href: routeMap.macroLab, label: 'Macros'",
      "href: routeMap.passiveTasks, label: 'Passive'",
      "href: routeMap.settings, label: 'Settings'"
    ]) {
      expect(source).toContain(expectedNav);
    }
  });
});
