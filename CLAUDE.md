# Events & Jumu'ah content is CMS-managed — don't hand-edit the cards

Event cards (both `events.html`'s grids and the homepage's
`.events-preview-scroll` preview) and the Jumu'ah/khutbah info (on `index.html`
and `prayer-times.html`) are no longer hand-authored HTML. They're generated at
build time by `scripts/build.js` from:

- `content/events/*.yml` — one file per event/program.
- `content/jummah.yml` — the single Jumu'ah info record.

**To add, edit, or remove an event: edit/add/delete a file under
`content/events/`, then run `npm run build`.** Don't add or edit
`.event-flyer-card` markup directly in `events.html` or `index.html` — it
lives between `<!-- CMS:EVENTS_GALLERY:START/END -->`,
`<!-- CMS:EVENTS_WEEKLY:START/END -->`, and
`<!-- CMS:EVENTS_HOMEPAGE:START/END -->` marker comments and gets overwritten
by the build. Same for the Jumu'ah info — it lives between
`<!-- CMS:JUMMAH_HERO:START/END -->` (index.html), and
`<!-- CMS:JUMMAH_BANNER:START/END -->` /
`<!-- CMS:JUMMAH_SIDEBAR:START/END -->` (prayer-times.html); edit
`content/jummah.yml` instead.

Non-developers can edit the same files through [Pages CMS](https://app.pagescms.org)
(GitHub login), configured via `.pages.yml` in the repo root, instead of
touching YAML directly.

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
  in `events.html`/`index.html` still re-sorts dated cards soonest-first and
  drops/archives past ones at page load regardless of this field.

The build (`scripts/build.js`) validates `dates`/`until`/`section` and fails
loudly with the offending filename if something's missing or malformed —
better to catch a bad CMS entry at build time than ship broken markup.

## Jumu'ah fields (`content/jummah.yml`)

Each of the two Jumu'ah prayers has its own time, khutbah title, and khateeb —
`first_time`, `first_khutbah_title`, `first_khateeb` for the 1st Jumu'ah, and
`second_time`, `second_khutbah_title`, `second_khateeb` for the 2nd. Injected
into the banner on `index.html` and both Jumu'ah blocks on
`prayer-times.html`.

If `first_khutbah_title` and `first_khateeb` both exactly match their
`second_*` counterparts (i.e. one khateeb is giving both khutbahs on the same
topic), the build collapses the two into a single combined block instead of
showing the same title/khateeb twice — only the two times still show
separately. Any difference in either field renders two separate per-Jumu'ah
cards. This comparison logic lives in `jummahSameTopic()` in
`scripts/build.js`.
