/**
 * Google Calendar events, as read at build time.
 *
 * The fetching, normalizing and flyer-downloading all happen in the prebuild
 * step (scripts/fetch-calendar.mjs); this module only reads what that wrote.
 * Keeping the network out of the Astro build means a page render can't hang on
 * a slow API call, and `astro dev` hot-reloads instantly against the cache.
 *
 * Entries come back already shaped like the YAML-authored events, so
 * EventCard.astro and dateAttrs() treat both identically.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Event } from './events';

// Resolved against the working directory rather than `import.meta.url`: Astro
// bundles this module into .astro/ before running it, so a URL relative to the
// source file points somewhere inside the build output. Both npm scripts run
// from the project root, which is also where the prebuild step writes.
const CACHE_FILE = path.join(process.cwd(), '.cache', 'gcal-events.json');

export function getCalendarEvents(): Event[] {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Event[];
  } catch {
    // Missing or unparseable cache means the prebuild step didn't run (a bare
    // `astro build`, say). The YAML events are still a complete site, so this
    // is a warning rather than a build failure.
    console.warn(
      '[gcal] .cache/gcal-events.json missing — run `node scripts/fetch-calendar.mjs` ' +
        'to include Google Calendar events. Building with content/events/*.yml only.',
    );
    return [];
  }
}
