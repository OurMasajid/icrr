import type { CollectionEntry } from 'astro:content';

export type Event = CollectionEntry<'events'>['data'];

export function dateAttrs(ev: Event): Record<string, string> {
  if (ev.schedule === 'dated') return { 'data-event-date': ev.dates! };
  if (ev.schedule === 'ongoing') return { 'data-event-until': ev.until! };
  return {};
}
