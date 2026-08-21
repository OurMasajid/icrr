import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { getCalendarEvents } from './gcal';

export type Event = CollectionEntry<'events'>['data'];

export function dateAttrs(ev: Event): Record<string, string> {
  if (ev.schedule === 'dated') return { 'data-event-date': ev.dates! };
  if (ev.schedule === 'ongoing') return { 'data-event-until': ev.until! };
  return {};
}

/**
 * Every event the site knows about, from both sources: the YAML files under
 * content/events/ (edited via Pages CMS) and the public Google Calendar.
 *
 * Returns plain `Event` objects rather than `CollectionEntry`s, because a
 * calendar event has no collection entry to wrap it — unwrapping here is what
 * lets callers treat the two sources identically.
 *
 * YAML wins a title collision: it's the hand-curated version, with a chosen
 * flyer and chip, so an event that exists in both places renders the better of
 * the two. That's also the migration path — copy an event into the calendar,
 * confirm it looks right, then delete the YAML file.
 */
export async function getAllEvents(): Promise<Event[]> {
  const yaml = (await getCollection('events')).map((entry) => entry.data);
  const seen = new Set(yaml.map((ev) => ev.title.trim().toLowerCase()));

  const calendar = getCalendarEvents().filter(
    (ev) => !seen.has(ev.title.trim().toLowerCase()),
  );

  return [...yaml, ...calendar];
}
