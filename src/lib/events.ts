import type { CollectionEntry } from 'astro:content';

export type Event = CollectionEntry<'events'>['data'];

export function dateAttrs(ev: Event): Record<string, string> {
  if (ev.schedule === 'dated') return { 'data-event-date': ev.dates! };
  if (ev.schedule === 'ongoing') return { 'data-event-until': ev.until! };
  return {};
}

// The day a card stops being upcoming, or null if it never does. Plain
// YYYY-MM-DD strings compare correctly as strings.
export function lastDate(ev: Event): string | null {
  if (ev.schedule === 'dated') return ev.dates!.split(',').at(-1)!;
  if (ev.schedule === 'ongoing') return ev.until!;
  return null;
}

// Today in the masjid's timezone, as YYYY-MM-DD. Builds run on UTC machines,
// where it's already tomorrow for the last hours of a Central evening.
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
}
