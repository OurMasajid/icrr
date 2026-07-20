# This is an Astro site — pages live in src/pages/*.astro

The site was migrated from hand-authored static HTML to
[Astro](https://astro.build). Each former `*.html` page is now
`src/pages/*.astro`, still built as flat `*.html` files at the same URLs
(`build.format: 'file'` in `astro.config.mjs`) — don't reintroduce Astro's
default `/about/` directory-style routing. Shared chrome (topbar, nav,
footer, `<head>` boilerplate) lives in `src/layouts/BaseLayout.astro` and
`src/components/`. Client-side scripts live in `src/scripts/*.client.js` and
are wired into pages via `<script>import '../scripts/foo.client.js'</script>`
— Astro bundles and content-hashes them automatically, so there's no more
manual hashing/rewriting step. `npm run build` runs `astro build`; `npm run
dev` runs the Astro dev server.

# Events & Jumu'ah content is CMS-managed — don't hand-edit the cards

Event cards (both the events page's grids and the homepage's
`.events-preview-scroll` preview) and the Jumu'ah/khutbah info (on the
homepage and prayer-times page) are not hand-authored markup. They're read at
build time from:

- `content/events/*.yml` — one file per event/program.
- `content/jummah.yml` — the single Jumu'ah info record.

These files intentionally live at the repo root (not under `src/content/`) so
[Pages CMS](https://app.pagescms.org)'s configured paths in `.pages.yml` keep
working unchanged for non-developers editing via GitHub login.

**To add, edit, or remove an event: edit/add/delete a file under
`content/events/`.** No build step is required to see it — `content/events/`
is wired up as an Astro content collection (`src/content.config.ts`, using
the `glob()` loader pointed at `../content/events`) and every page that lists
events calls `getCollection('events')` and renders each entry through
`src/components/EventCard.astro`. Don't hand-write `.event-flyer-card`
markup in a page — add a YAML file instead. Same for the Jumu'ah info:
`src/lib/jummah.ts` reads `content/jummah.yml` directly (it's a single
record, not a list, so it isn't a content collection), and
`src/components/JummahHero.astro` / `JummahBanner.astro` /
`JummahSidebar.astro` render it on the homepage and prayer-times page.

## Event fields (`content/events/<slug>.yml`)

- `title`, `detail` — card heading and the line underneath.
- `image` — path under `images/`.
- `chip`, `chip_style` (`default` | `gold`) — the small badge on the card.
- `section` — `gallery` (one-off/ongoing, shown in "Upcoming Events &
  Programs") or `weekly` (perpetual, shown in "Weekly Programs").
- `schedule` — `dated`, `ongoing`, or `none`:
  - `dated` requires `dates` — one ISO date, or comma-separated ISO dates for
    a multi-day event (e.g. `2026-07-10,2026-07-11`). The card archives once
    the **last** listed date passes.
  - `ongoing` requires `until` (ISO date) — stays "Upcoming" until that date
    passes.
  - `none` — perpetual, never archived. Used for the "Weekly Programs"
    section. Recurring items with a specific next occurrence (e.g. "Next: Jul
    18" workshops, "every 3rd Saturday" potlucks) should use `dated` instead,
    with someone **bumping `dates` manually each cycle** — there's no
    recurrence engine, just a single next-occurrence date.
- `show_on_homepage` — also render this card in the homepage preview.
- `homepage_day` (0=Sun…6=Sat) — only for `schedule: none` cards shown on the
  homepage; adds the weekday `today-event` highlight glow there (mirrors the
  old `data-event-day` convention).
- `order` — lower sorts first in the pre-JS/initial order. The runtime script
  in `src/scripts/events-sort.client.js` / `home.client.js` still re-sorts
  dated cards soonest-first and drops/archives past ones at page load
  regardless of this field.

The content collection schema (`src/content.config.ts`) validates
`dates`/`until`/`section` and fails the build loudly with the offending
filename if something's missing or malformed — better to catch a bad CMS
entry at build time than ship broken markup.

## Jumu'ah fields (`content/jummah.yml`)

Each of the two Jumu'ah prayers has its own time, khutbah title, and khateeb —
`first_time`, `first_khutbah_title`, `first_khateeb` for the 1st Jumu'ah, and
`second_time`, `second_khutbah_title`, `second_khateeb` for the 2nd.

If `first_khutbah_title` and `first_khateeb` both exactly match their
`second_*` counterparts (i.e. one khateeb is giving both khutbahs on the same
topic), the Jummah components collapse the two into a single combined block
instead of showing the same title/khateeb twice — only the two times still
show separately. Any difference in either field renders two separate
per-Jumu'ah cards. This comparison logic lives in `jummahSameTopic()` in
`src/lib/jummah.ts`.
