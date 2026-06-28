#!/usr/bin/env node

process.env.HUB_HYDRATED_DESK_WRITES = '1';

await import('./hub-hydrated-smoke.mjs');
