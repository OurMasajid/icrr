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

# Push notifications are sent from Our Masajid, not from here

The homepage's "Get notifications on your phone" panel
(`src/components/NotificationOptIn.astro`) subscribes visitors to the
`icrr-all` Firebase Cloud Messaging topic. This site only handles the *opt-in*
— minting a registration token and handing it to the Our Masajid API, which
subscribes it to the topic. Composing and sending a broadcast happens in the
Our Masajid admin at `/admin/icrr/push`; there is no send path in this repo,
and no Firebase service account here (that's a secret and it lives there).

Three pieces, and they're easy to break independently:

- `public/firebase-messaging-sw.js` — the service worker. Lives in `public/`
  so it's copied verbatim to the web root; a service worker can only control
  pages at or below its own path, so it must stay at the root. It's plain JS
  with **no Firebase SDK import** on purpose — broadcasts are sent as
  data-only messages, which arrive as ordinary Web Push events it renders
  itself. That's also what lets a tap open a URL chosen per-message.
- `src/scripts/push-subscribe.client.js` — the opt-in flow. Imports the
  Firebase SDK **dynamically**, so the (large) chunk is only fetched when
  someone actually taps the button. Keep it that way.
- `PUBLIC_FIREBASE_*` env vars (below). The panel renders only when **all** of
  them are present, so an unconfigured deploy shows nothing instead of a button
  that can't work. This is why the section is invisible locally unless you set
  up `.env`.

## Environment variables (Firebase)

Set these in Netlify (Site configuration → Environment variables) for
production, and in a local `.env` for development. Every `.env*` file is
gitignored, which is why this list lives here rather than in a checked-in
example file.

| Variable | Where it comes from |
| --- | --- |
| `PUBLIC_FIREBASE_API_KEY` | Firebase console → Project settings → General → Your apps → Web app |
| `PUBLIC_FIREBASE_AUTH_DOMAIN` | same panel |
| `PUBLIC_FIREBASE_PROJECT_ID` | same panel |
| `PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | same panel |
| `PUBLIC_FIREBASE_APP_ID` | same panel |
| `PUBLIC_FIREBASE_VAPID_KEY` | Project settings → Cloud Messaging → Web configuration → Web Push certificates → "Key pair". Not the same as any VAPID key in the Our Masajid repo. |
| `PUBLIC_OURMASAJID_API` | Optional. Where registration tokens are sent to be subscribed to the topic; defaults to `https://ourmasajid.com`. Override when testing locally. |

**None of these are secrets.** Astro exposes every `PUBLIC_`-prefixed variable
to client code, so all of them ship in the browser bundle by design — Firebase
enforces access through its security rules, not through key secrecy. The
service account that actually *sends* notifications lives in the Our Masajid
app, never here.

# Event cards come from two places: Google Calendar and YAML

`src/lib/events.ts` exports `getAllEvents()`, which merges both sources into one
list of cards. Both pages that show events (`src/pages/index.astro` and
`src/pages/events.astro`) call it; neither calls `getCollection('events')`
directly any more.

**A YAML event wins a title collision**, because it's the hand-curated version
with a chosen flyer and chip. That's also the migration path: copy an event into
the calendar, confirm it looks right, then delete the YAML file.

## The Google Calendar half

`scripts/fetch-calendar.mjs` runs as a **prebuild step** (wired into both `npm
run dev` and `npm run build`) and writes two gitignored things:

- `.cache/gcal-events.json` — normalized events, read by `src/lib/gcal.ts`.
- `public/images/gcal/*` — flyer images downloaded from event attachments.

Set `GCAL_CALENDAR_ID` and `GCAL_API_KEY` to enable it. With neither set the
script writes an empty list and exits 0, so the site builds from YAML alone —
that's what keeps local development working without secrets.

| Variable | Where it comes from |
| --- | --- |
| `GCAL_CALENDAR_ID` | Calendar → Settings for the calendar → Integrate calendar → *Calendar ID*. The calendar needs "Make available to public" enabled. |
| `GCAL_API_KEY` | Google Cloud console → APIs & Services → Credentials → API key, with **both the Calendar API and the Drive API** enabled and the key restricted to those two. |

These are deliberately **not** `PUBLIC_`-prefixed, unlike the Firebase values
above: Astro only exposes `PUBLIC_*` to client code, so the plain names keep the
key server-side, used at build time and never shipped in the browser bundle
where someone could lift it and burn the quota.

**Flyers are downloaded, never hotlinked.** A Calendar attachment's `fileUrl` is
a Drive *viewer page*, not an image, and Google blocks hotlinking Drive files
from other domains (`uc?export=view` returns 403). So the build machine fetches
the bytes via the Drive API and the browser only ever loads a same-origin
`/images/gcal/...` path. This is why the Drive API has to be enabled on the key,
and why **each attached flyer must also be shared as "Anyone with the link"** —
making the *calendar* public does not make its *attachments* public.

An event with no usable flyer isn't an error: `EventCard.astro` renders a
generated date block instead (`.event-flyer-placeholder`). A failed download
warns and falls back the same way, so one bad attachment never fails a build.

### What an editor can control from inside a Calendar event

Recurring events land in "Weekly Programs" and one-offs in "Upcoming Events &
Programs". Lines and tags in the event's **description** override that and the
rest of the card; they're stripped out before anything renders:

- `image:`, `detail:`, `chip:` — override the derived value.
- `[weekly]` / `[upcoming]` — force the section.
- `[homepage]` — also show the card in the homepage preview.

Cancelled events, and any title starting `(Suspended)` — a convention already in
use on this calendar — are skipped.

### The site is static, so the calendar isn't live

Cards are baked in at build time, and nothing in the repo changes when a
calendar does. `.github/workflows/rebuild.yml` pings a Netlify build hook nightly
to close that gap; the same hook URL can be opened from a phone to refresh
immediately after adding an event.

# Events & Jumu'ah content is CMS-managed — don't hand-edit the cards

Event cards (both the events page's grids and the homepage's
`.events-preview-scroll` preview) and the Jumu'ah/khutbah info (on the
homepage and prayer-times page) are not hand-authored markup. They're read at
build time from:

- `content/events/*.yml` — one file per event/program. (Since the Google
  Calendar integration above, this is one of *two* sources of event cards —
  everything below still applies to the YAML half.)
- `content/jummah.yml` — the single Jumu'ah info record.

These files intentionally live at the repo root (not under `src/content/`) so
[Pages CMS](https://app.pagescms.org)'s configured paths in `.pages.yml` keep
working unchanged for non-developers editing via GitHub login.

**To add, edit, or remove an event: edit/add/delete a file under
`content/events/`.** No build step is required to see it — `content/events/`
is wired up as an Astro content collection (`src/content.config.ts`, using
the `glob()` loader pointed at `../content/events`) and every page that lists
events calls `getAllEvents()` (see above) and renders each entry through
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
