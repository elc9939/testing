# Career Desk System Improvements

Last updated: 2026-06-10

## Goal
Make Career Desk better at remembering what it has already found, ranking new leads, and turning daily scout results into a clean apply queue instead of a noisy pile of job links.

## Implementation Checklist
- [x] Add a persistent project checklist so future scout and tracker work has a stable target.
- [x] Add computed fit scoring for every lead using Edward's May 2027 timeline, entry-level target, work authorization, math/data/research fit, location priority, and prior-application risk.
- [x] Add seen-lead / duplicate-risk labels so repeated roles are called out as exact duplicates, prior applications, possible duplicates, or likely new leads.
- [x] Add urgency labels for due dates, deadlines, stale active leads, and high-fit saved leads.
- [x] Add source-quality labels so official/direct leads are distinguished from job-board mirrors or unclear sources.
- [x] Improve To-do sections so passive "check email/portal" work does not crowd out real actions.
- [x] Show resume-angle suggestions for strong leads so applications can be tailored faster.
- [x] Add a compact scout-intelligence panel with counts for high-fit leads, duplicate risks, urgent actions, and stale active rows.
- [x] Add bounded Career Discovery filter memory so repeated low-fit/excluded source fingerprints do not resurface every passive sweep.
- [ ] Add a true persisted `seenLeadRegistry` export/import object once scout results are added through an in-app import flow instead of only by seed JSON.
- [ ] Add a weekly strategy review view that summarizes rejections, interviews, stale leads, and role categories.
- [ ] Add a company watchlist editor so priority companies can be managed without code edits.
- [ ] Add structured fields for source URL quality, posting date, deadline confidence, graduation-fit confidence, and duplicate status when new scout leads are imported.

## Current Approach
The first pass intentionally uses computed metadata. Existing jobs are not migrated, and localStorage entries are not rewritten until the user edits or marks them. This keeps the tracker low-risk while making the UI smarter immediately.

## Scout Rules To Preserve
- Search in rotating lanes rather than repeating the same famous companies every run.
- Avoid adding duplicates unless the posting is clearly a new cycle, new location, or new role.
- Keep ordinary to-dos concrete: apply, respond, schedule, complete assessment, prepare, decide, follow up, or archive.
- Do not create to-dos that merely tell Edward to check email or portals.
- Rank leads by fit and urgency, not just brand prestige.
