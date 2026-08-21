#!/usr/bin/env node
/**
 * Build-time fetch of the public ICRR Google Calendar.
 *
 * Runs as a prebuild step (see package.json) rather than as an Astro
 * integration, for three reasons: it writes flyer images into public/ *before*
 * Astro copies that directory into dist/, it behaves identically under
 * `astro dev` and `astro build`, and it can be run on its own when something
 * looks wrong.
 *
 * It writes two things:
 *   .cache/gcal-events.json   — normalized events, read by src/lib/gcal.ts
 *   public/images/gcal/*      — flyer images downloaded from event attachments
 *
 * Both are gitignored: they're derived from the calendar, not source.
 *
 * ## Why the images are downloaded instead of hotlinked
 *
 * A Calendar attachment's `fileUrl` is Drive's `alternateLink` — a viewer
 * *page*, not an image — and Google now blocks hotlinking Drive files from
 * external domains (`uc?export=view` returns 403; the `thumbnail?id=` endpoint
 * is unofficial and low-resolution). Downloading the bytes here, on the build
 * machine, sidesteps all of it: the browser only ever loads a same-origin
 * /images/gcal/... path, at full resolution, under the immutable cache header
 * netlify.toml already sets for /images/*.
 *
 * ## Unconfigured is not an error
 *
 * With no GCAL_* env vars set, this writes an empty list and exits 0, so the
 * site still builds from content/events/*.yml alone. That's what keeps local
 * development working without secrets — the same principle as
 * NotificationOptIn.astro rendering nothing when Firebase isn't configured.
 */
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE_FILE = path.join(ROOT, '.cache', 'gcal-events.json');
const IMAGE_DIR = path.join(ROOT, 'public', 'images', 'gcal');
/** Public URL prefix for the above. Matches the `image` field on YAML events,
 *  which are stored relative to the web root without a leading slash. */
const IMAGE_URL_PREFIX = 'images/gcal';

const TZ = 'America/Chicago';
const CAL_ID = process.env.GCAL_CALENDAR_ID;
const API_KEY = process.env.GCAL_API_KEY;

/** Attachments arrive as whatever the organizer dragged in; only render the
 *  ones a browser can actually display in an <img>. */
const IMAGE_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** A multi-day event emits one ISO date per day so events-sort.client.js can
 *  archive it after the *last* one. Cap the span so a mistakenly year-long
 *  event doesn't emit 365 dates into a data attribute. */
const MAX_SPAN_DAYS = 14;

const warnings = [];
function warn(message) {
  warnings.push(message);
  console.warn(`  ! ${message}`);
}

/* ---------------------------------------------------------------- dates -- */

/** YYYY-MM-DD for an instant, as it reads on a wall calendar in `tz`. Using
 *  Intl avoids a date library: the parts are already localized to the zone. */
function ymdInTZ(date, tz = TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(ymd, n) {
  // Parse as UTC noon so a DST transition can't nudge the result across a day
  // boundary — we only ever read the Y/M/D back out.
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The comma-separated ISO date list for an event.
 *
 * Two traps here. All-day events express `end.date` as *exclusive* (a one-day
 * event on the 5th ends on the 6th), so the last real day is end - 1. Timed
 * events express `end.dateTime` inclusively, so no adjustment.
 */
function eventDates(ev) {
  const startYmd = ev.start.date ?? ymdInTZ(new Date(ev.start.dateTime));
  let endYmd = startYmd;

  if (ev.end?.date) {
    endYmd = addDays(ev.end.date, -1);
  } else if (ev.end?.dateTime) {
    endYmd = ymdInTZ(new Date(ev.end.dateTime));
  }
  if (endYmd < startYmd) endYmd = startYmd;

  const dates = [];
  for (let d = startYmd; d <= endYmd && dates.length < MAX_SPAN_DAYS; d = addDays(d, 1)) {
    dates.push(d);
  }
  return dates.join(',');
}

/** "Sat, Jul 11 · 8:00 PM" — matches the hand-written style of the `detail`
 *  lines on the existing YAML events. All-day events omit the time. */
function formatWhen(ev) {
  const isAllDay = Boolean(ev.start.date);
  const start = new Date(isAllDay ? `${ev.start.date}T12:00:00Z` : ev.start.dateTime);

  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: isAllDay ? 'UTC' : TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(start);

  if (isAllDay) return day;

  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
  }).format(start);
  return `${day} · ${time}`;
}

/** "This Saturday" / "Next Tuesday" / "September" — the small badge on a card. */
function deriveChip(firstDate, todayYmd) {
  const days = Math.round(
    (Date.parse(`${firstDate}T12:00:00Z`) - Date.parse(`${todayYmd}T12:00:00Z`)) / 86_400_000,
  );
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';

  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
  }).format(new Date(`${firstDate}T12:00:00Z`));

  if (days < 7) return `This ${weekday}`;
  if (days < 14) return `Next ${weekday}`;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long' }).format(
    new Date(`${firstDate}T12:00:00Z`),
  );
}

/* ---------------------------------------------------------- description -- */

/**
 * Calendar descriptions are rich text: Google stores them with HTML tags and
 * entities (`<strong>`, `<br>`, `&nbsp;`). Anything reaching a card has to be
 * plain text, both to render correctly and so a pasted `<script>` can never
 * reach the page.
 */
function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Pull the `key: value` override lines and `[tag]` markers out of a
 * description, returning them alongside the description with those lines
 * removed — an editor's overrides are directives for this script, not copy to
 * show on the card.
 *
 * Recognized: `image:`, `detail:`, `chip:` and the [weekly] / [upcoming] /
 * [homepage] tags.
 */
function parseOverrides(rawDescription) {
  const text = htmlToText(rawDescription || '');
  const overrides = {};
  const tags = new Set();

  const kept = text
    .split('\n')
    .filter((line) => {
      const kv = line.match(/^\s*(image|detail|chip)\s*:\s*(.+?)\s*$/i);
      if (kv) {
        overrides[kv[1].toLowerCase()] = kv[2];
        return false;
      }
      return true;
    })
    .join('\n');

  const body = kept.replace(/\[(weekly|upcoming|homepage)\]/gi, (_, tag) => {
    tags.add(tag.toLowerCase());
    return '';
  });

  return { overrides, tags, body: body.replace(/\n{2,}/g, '\n').trim() };
}

/* ---------------------------------------------------------------- fetch -- */

async function fetchJSON(url, what) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${what} failed: HTTP ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  return res.json();
}

/** Every upcoming event, with recurring series already expanded into
 *  individual occurrences (`singleEvents=true`) so each one has a real date. */
async function fetchEvents() {
  const items = [];
  let pageToken;

  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}/events`,
    );
    url.searchParams.set('key', API_KEY);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('timeMin', new Date().toISOString());
    url.searchParams.set('timeZone', TZ);
    url.searchParams.set('maxResults', '250');
    // Documented for *modifying* attachments, but sending it on reads is what
    // makes the attachments array come back populated.
    url.searchParams.set('supportsAttachments', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const page = await fetchJSON(url, 'Calendar events.list');
    items.push(...(page.items || []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return items;
}

/**
 * Download an event's first image attachment, returning its site-relative
 * path — or null, having warned, if anything goes wrong. A flyer that can't be
 * fetched must never fail the build: the card falls back to the text design
 * and the event still appears.
 */
async function downloadFlyer(attachment, eventTitle) {
  const ext = IMAGE_EXT[attachment.mimeType?.toLowerCase()];
  if (!ext) return null;

  const filename = `${attachment.fileId}${ext}`;
  const dest = path.join(IMAGE_DIR, filename);
  const publicPath = `${IMAGE_URL_PREFIX}/${filename}`;

  // Drive file IDs are content-addressed enough for our purposes: replacing a
  // flyer means a new attachment with a new ID, so a cached file is never stale.
  if (existsSync(dest)) return publicPath;

  try {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${attachment.fileId}`);
    url.searchParams.set('alt', 'media');
    url.searchParams.set('key', API_KEY);

    const res = await fetch(url);
    if (!res.ok) {
      warn(
        `"${eventTitle}": flyer download failed (HTTP ${res.status}). ` +
          `Is the Drive file shared as "Anyone with the link"?`,
      );
      return null;
    }

    // Drive answers an unauthorized request with an HTML interstitial and a
    // 200, so trusting the status code alone would write a web page to disk
    // with a .jpg extension.
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      warn(`"${eventTitle}": flyer download returned ${contentType || 'no content-type'}, not an image.`);
      return null;
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) {
      warn(`"${eventTitle}": flyer download was empty.`);
      return null;
    }

    await writeFile(dest, bytes);
    console.log(`  ↓ ${publicPath} (${Math.round(bytes.length / 1024)} KB) — ${eventTitle}`);
    return publicPath;
  } catch (err) {
    warn(`"${eventTitle}": flyer download errored — ${err.message}`);
    return null;
  }
}

/* ------------------------------------------------------------ normalize -- */

/**
 * Map a Calendar event onto the shape src/components/EventCard.astro already
 * renders, so calendar and YAML events are interchangeable downstream.
 */
async function normalize(ev, index, todayYmd) {
  const { overrides, tags, body } = parseOverrides(ev.description);
  const dates = eventDates(ev);
  const firstDate = dates.split(',')[0];

  // `recurringEventId` is present on every occurrence the API expanded out of a
  // series, which is a good proxy for "this is a standing program" rather than
  // a one-off. The tags let an editor override it either way — a monthly
  // potluck recurs but still belongs under Upcoming.
  let section = ev.recurringEventId ? 'weekly' : 'gallery';
  if (tags.has('weekly')) section = 'weekly';
  if (tags.has('upcoming')) section = 'gallery';

  let image = overrides.image || '';
  const attachment = (ev.attachments || []).find((a) =>
    IMAGE_EXT[a.mimeType?.toLowerCase()],
  );
  if (attachment) {
    image = (await downloadFlyer(attachment, ev.summary)) || image;
  }

  // The full venue line ("Islamic Center of Round Rock, 1951 Hampton Ln, ...")
  // is far too long for a card; the venue name alone is what's useful.
  const venue = (ev.location || '').split(',')[0].trim();
  const detail =
    overrides.detail || [formatWhen(ev), venue].filter(Boolean).join(' · ');

  return {
    title: ev.summary || 'Untitled event',
    detail,
    image,
    chip: overrides.chip || deriveChip(firstDate, todayYmd),
    chip_style: 'default',
    section,
    // A standing program has no single date to archive against; a one-off does.
    schedule: section === 'weekly' ? 'none' : 'dated',
    dates: section === 'weekly' ? undefined : dates,
    until: undefined,
    show_on_homepage: tags.has('homepage'),
    homepage_day: undefined,
    // Sorts calendar events after the hand-curated YAML ones, which use
    // single-digit `order`. Dated cards get re-sorted soonest-first at runtime
    // by events-sort.client.js regardless.
    order: 50 + index,
    // Not rendered today, but carried through so a future card design can show
    // the blurb without another round-trip to the API.
    body,
  };
}

/* ----------------------------------------------------------------- main -- */

async function main() {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });

  if (!CAL_ID || !API_KEY) {
    console.log(
      'fetch-calendar: GCAL_CALENDAR_ID / GCAL_API_KEY not set — ' +
        'building with content/events/*.yml only.',
    );
    await writeFile(CACHE_FILE, '[]\n');
    return;
  }

  await mkdir(IMAGE_DIR, { recursive: true });
  console.log(`fetch-calendar: reading ${CAL_ID}`);

  const raw = await fetchEvents();

  // Cancelled events still come back from the API, and this calendar has a
  // convention of prefixing a paused program's title with "(Suspended)".
  // Neither belongs on the site.
  const live = raw.filter(
    (ev) =>
      ev.status !== 'cancelled' &&
      ev.summary &&
      !/^\s*\(\s*suspended\s*\)/i.test(ev.summary),
  );

  const todayYmd = ymdInTZ(new Date());
  const events = [];
  for (const [i, ev] of live.entries()) {
    events.push(await normalize(ev, i, todayYmd));
  }

  await writeFile(CACHE_FILE, `${JSON.stringify(events, null, 2)}\n`);

  const withFlyers = events.filter((e) => e.image).length;
  console.log(
    `fetch-calendar: ${events.length} upcoming event(s) ` +
      `(${raw.length - live.length} cancelled/suspended skipped), ` +
      `${withFlyers} with a flyer.`,
  );
  if (warnings.length) {
    console.warn(`fetch-calendar: ${warnings.length} warning(s) above — those cards render as text.`);
  }
}

main().catch(async (err) => {
  // A calendar outage must not take down a deploy of an otherwise-unchanged
  // site: warn loudly, fall back to the YAML events, and let the build finish.
  console.error(`fetch-calendar: FAILED — ${err.message}`);
  console.error('fetch-calendar: falling back to content/events/*.yml only.');
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  if (!existsSync(CACHE_FILE)) await writeFile(CACHE_FILE, '[]\n');
});
