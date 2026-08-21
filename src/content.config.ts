// CMS-managed event/program cards, authored as git-backed YAML so
// non-developers can edit them via Pages CMS (see .pages.yml). The files
// themselves live at the repo root under content/events/ — not under
// src/content/ — so that Pages CMS's configured path keeps working
// unchanged.
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { fileURLToPath } from 'node:url';

const eventsDir = fileURLToPath(new URL('../content/events', import.meta.url));

// An unquoted `2026-08-28` in YAML is a timestamp, not a string, so the loader
// hands us a Date. Pages CMS writes these fields unquoted, which used to fail
// the build against `z.string()`. Normalize a Date back to YYYY-MM-DD (the
// YAML spec reads a date-only timestamp as UTC midnight, so read it in UTC —
// local getters would shift the day west of Greenwich) and leave strings
// alone, so both spellings validate identically.
const isoDate = () =>
  z.preprocess(
    (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value),
    z.string().optional(),
  );

const events = defineCollection({
  loader: glob({ pattern: '**/*.{yml,yaml}', base: eventsDir }),
  schema: z
    .object({
      title: z.string(),
      detail: z.string().default(''),
      // Optional: an event with no flyer renders the generated date card
      // instead (see src/components/EventCard.astro).
      image: z.string().default(''),
      chip: z.string().default(''),
      chip_style: z.enum(['default', 'gold']).default('default'),
      section: z.enum(['gallery', 'weekly']),
      schedule: z.enum(['dated', 'ongoing', 'none']).default('dated'),
      dates: isoDate(),
      until: isoDate(),
      show_on_homepage: z.boolean().default(false),
      homepage_day: z.number().min(0).max(6).optional(),
      order: z.number().default(0),
    })
    .superRefine((data, ctx) => {
      if (
        data.schedule === 'dated' &&
        !/^\d{4}-\d{2}-\d{2}(,\d{4}-\d{2}-\d{2})*$/.test(data.dates || '')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'schedule "dated" requires "dates" as YYYY-MM-DD or comma-separated YYYY-MM-DD dates',
          path: ['dates'],
        });
      }
      if (data.schedule === 'ongoing' && !/^\d{4}-\d{2}-\d{2}$/.test(data.until || '')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'schedule "ongoing" requires "until" as YYYY-MM-DD',
          path: ['until'],
        });
      }
    }),
});

export const collections = { events };
