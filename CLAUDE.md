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

Visitors can start the opt-in from two places, and both run the same flow:
the bell in the site header (`src/components/NotificationBell.astro`, on every
page via `Nav.astro`) and the homepage panel. The bell exists because the
panel sits at the bottom of one page — too far away to find. Tapping either
one asks the browser for permission right there; there's no intermediate page.

The pieces, and they're easy to break independently:

- `public/firebase-messaging-sw.js` — the service worker. Lives in `public/`
  so it's copied verbatim to the web root; a service worker can only control
  pages at or below its own path, so it must stay at the root. It's plain JS
  with **no Firebase SDK import** on purpose — broadcasts are sent as
  data-only messages, which arrive as ordinary Web Push events it renders
  itself. That's also what lets a tap open a URL chosen per-message.
- `src/scripts/push-subscribe.client.js` — the opt-in flow, loaded on every
  page by `BaseLayout.astro`. It binds *every* `[data-push-button]` on the
  page and keeps them all in one state, so the header bell can't still read
  "Enable notifications" after the panel below it has been switched on. A
  button outside the panel has no status line next to it, so those clicks
  report via a toast instead. Imports the Firebase SDK **dynamically**, so
  the (large) chunk is only fetched when someone actually taps a button —
  keep it that way.
- `src/lib/push.ts` and `src/components/PushConfig.astro` — the config, read
  from env once and emitted once per page as a hidden `[data-push-config]`
  element for the script to pick up. Neither control carries the config
  itself.
- `PUBLIC_FIREBASE_*` env vars, set in Netlify — see `.env.example`. The bell
  and the panel render only when all of them are present, so an unconfigured
  deploy shows nothing instead of a button that can't work. This is why
  they're invisible locally unless you set up `.env`.

# The "install us" card only shows to repeat visitors

`src/components/AppPrompt.astro` is the card that asks a visitor to add the
site to their home screen and turn notifications on. It's rendered (hidden) on
every page by `BaseLayout.astro`, and `src/scripts/visit-prompt.client.js`
decides whether anyone ever sees it.

That decision is made from a count of **distinct days visited**, kept in
`localStorage` under `icrr:visits` — a list of `YYYY-MM-DD` strings plus a
first-seen date, how many times the card has been shown, and a snooze
timestamp. There is no identifier, no cookie, and no network call: nothing
about a visitor's history leaves their device, and clearing site data resets
it. Keep it that way — this is a nudge, not analytics.

The thresholds are constants at the top of the script: four distinct days in
the last fortnight, and at least a week since the first visit (a burst of
curiosity over one weekend doesn't qualify). The card then waits 12 seconds
before appearing, comes back in a fortnight if it's ignored, in two months if
it's dismissed, and never after three showings.

The two asks are independent and either one is dropped once it's settled:

- **Install.** Where the browser offers `beforeinstallprompt` (Chrome/Edge,
  Android) the card gets a real one-tap install button; the event is captured
  at the top of the script because it fires once and early. Everywhere else —
  iOS Safari above all, where "Add to Home Screen" only exists in the Share
  sheet — the card explains the manual route instead of showing a button that
  can't do anything.
- **Notifications.** Not a second opt-in flow: the card's button carries
  `data-push-button` inside a `[data-push-optin]` block, so
  `push-subscribe.client.js` binds it like the header bell, keeps them in the
  same state, and writes progress into the card's own status line. This is why
  the card is server-rendered rather than built in JS — that script binds what
  it finds at parse time. `visit-prompt.client.js` only watches the block's
  `data-push-state` to know when to stop asking. On iOS the two asks are
  really one: Safari exposes no Push API until the site is installed, so the
  notification half stays hidden there.

One related trap: `global.css` sets `[hidden] { display: none !important }`.
Tailwind's utilities and component classes like `.btn` outrank the browser's
own `[hidden]` rule, so without it an element hidden by `el.hidden` — which
both this script and the push script's `hideControls()` rely on — stays on
screen.

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

## Some event cards are synced from Google Calendar, not hand-authored

`content/events/gcal-*.yml` files are **generated**, not edited by hand — a
scheduled GitHub Actions workflow
(`.github/workflows/gcal-events-sync.yml`, hourly 6am–10pm America/Chicago)
runs `scripts/sync-gcal-events.mjs`, which pulls the ICRR Google Calendar's
public iCal feed and writes/updates/deletes these files to match it, then
commits straight to `main`. Netlify's normal on-push build picks the commit
up like any other. The prefix is load-bearing: it's how the script tells
"mine, safe to overwrite or delete" apart from every hand-authored file in
the same directory, which it never touches. **To change a synced card,
edit the calendar event, not the YAML file** — the next hourly run
overwrites it anyway.

A calendar event only becomes a card if its description contains a
Pinterest link (a `pinterest.com/pin/...` or `pin.it/...` URL, or a direct
`i.pinimg.com` image URL) — the schema's `image` field is required, and this
is the only source of it for synced cards. The script fetches that link
once per run to read the pin's `og:image` (the same signal
`src/scripts/pinterest-board.client.js` gets for free from Pinterest's RSS)
and hotlinks the resulting `i.pinimg.com` URL directly, the same way the
Pinterest board embed does — nothing is downloaded into `public/images`.
Pinterest doesn't always render that tag server-side for every pin/link
shape; when resolution fails, an already-published card is left alone
rather than deleted (a scrape miss isn't the same as the event actually
disappearing from the calendar) and a new card is skipped with a warning
in the workflow log rather than failing the build.

Recurring calendar events (an `RRULE`) are expanded into one dated card per
upcoming occurrence within a 10-day lookahead (and a 1-day lookback, so a
card doesn't vanish the instant it starts), each its own
`gcal-<uid>-<date>.yml` — there's no `schedule: none` card for these, so a
perpetual weekly program still meant to show in "Weekly Programs" stays
hand-authored (see above) rather than calendar-driven. Every synced card
uses `section: gallery`, `schedule: dated`, and `show_on_homepage: true`.

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
