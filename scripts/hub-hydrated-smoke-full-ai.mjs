#!/usr/bin/env node

process.env.HUB_HYDRATED_AI_LAB_CLASSIFY = '1';

await import('./hub-hydrated-smoke.mjs');
