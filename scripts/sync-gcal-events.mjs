#!/usr/bin/env node
// Syncs event cards from the ICRR Google Calendar into content/events/.
//
// Run hourly (6am–10pm) by .github/workflows/gcal-events-sync.yml. Pulls the
// calendar's public iCal feed, turns each occurrence (recurring events are
// expanded into one card per upcoming occurrence) into a
// content/events/gcal-<uid>[-<date>].yml card matching the schema
// src/content.config.ts validates, and removes any gcal-*.yml file whose
// occurrence has genuinely disappeared from the feed.
//
// Never hand-edit a gcal-*.yml file — the next hourly run overwrites it.
// Edit the calendar event instead. Hand-authored cards (any filename not
// starting with "gcal-") are never touched by this script.
//
// A card's image comes from a Pinterest link in the calendar event's
// description: either a direct i.pinimg.com URL, or a pinterest.com/pin/...
// or pin.it/... link, whose page we fetch once (per run) to read its
// og:image meta tag — the same signal the Pinterest board embed
// (src/scripts/pinterest-board.client.js) relies on, just read at
// scrape-time instead of from Pinterest's own RSS. Calendar events without a
// resolvable Pinterest image are skipped (logged, not written), since
// content.config.ts requires `image` — this is expected for anything on the
// calendar that isn't meant to become a site event card.
//
// Pinterest doesn't always render `og:image` server-side for a given pin
// (observed on some pin.it-style short links — same "still processing"
// class of gap pinterest-board.client.js already tolerates), so a fetch
// failure or missing tag is treated as "couldn't resolve this run", not
// "the event has no image": an already-published card is left untouched
// rather than deleted over a transient scrape miss. A card is deleted only
// when its occurrence is genuinely gone from the calendar feed.

import fs from 'node:fs';
import path from 'node:path';
import ical from 'node-ical';
import { dump, load } from 'js-yaml';

const CALENDAR_ID = 'rsj97g97q6ud471umpr1p8sr5c@group.calendar.google.com';
const ICS_URL =
  process.env.GCAL_ICS_URL ||
  `https://calendar.google.com/calendar/ical/${encodeURIComponent(CALENDAR_ID)}/public/basic.ics`;

const TZ = 'America/Chicago'; // Round Rock, TX
const PREFIX = 'gcal-';
const EVENTS_DIR = path.join(process.cwd(), 'content/events');

// Only sync occurrences in this window. Anything older is left alone
// entirely (existing files untouched, never reconsidered for deletion) so a
// years-deep calendar history doesn't get walked every hour; anything
// further out isn't expanded yet — a later run picks it up as it enters the
// window.
const PAST_DAYS = 3;
const FUTURE_DAYS = 90;

const DAY_FMT_LOCAL = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const DAY_FMT_UTC = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const TIME_FMT_LOCAL = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function isoDateParts(date, dateOnly) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: dateOnly ? 'UTC' : TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date); // en-CA gives YYYY-MM-DD directly
}

function dayLabel(date, dateOnly) {
  return (dateOnly ? DAY_FMT_UTC : DAY_FMT_LOCAL).format(date);
}

function timeLabel(date) {
  return TIME_FMT_LOCAL.format(date).replace(' ', ' ');
}

// ICS all-day DTEND is exclusive (the day *after* the last full day) —
// subtract a day so "the last day" means what a human reading the calendar
// would expect.
function inclusiveEnd(start, end, dateOnly) {
  if (!dateOnly) return end;
  const d = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return d < start ? start : d;
}

function formatDetail(start, end, dateOnly) {
  const lastDay = inclusiveEnd(start, end, dateOnly);
  const sameDay = isoDateParts(start, dateOnly) === isoDateParts(lastDay, dateOnly);

  if (dateOnly) {
    return sameDay ? dayLabel(start, true) : `${dayLabel(start, true)} – ${dayLabel(lastDay, true)}`;
  }

  const startDay = dayLabel(start, false);
  if (sameDay) {
    return `${startDay} · ${timeLabel(start)} – ${timeLabel(end)}`;
  }
  return `${startDay} ${timeLabel(start)} – ${dayLabel(lastDay, false)} ${timeLabel(end)}`;
}

function slugify(text, maxLen = 48) {
  return text
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

// --- Pinterest image resolution ------------------------------------------

const PIN_LINK_RE = /https?:\/\/(?:[a-z0-9-]+\.)?(?:pinterest\.[a-z.]+\/pin\/[a-zA-Z0-9_-]+\/?|pin\.it\/[a-zA-Z0-9]+)/i;
const PIN_IMAGE_RE = /https?:\/\/i\.pinimg\.com\/[^\s"'<>)]+/i;

function isPinterestImageHost(url) {
  try {
    return /(^|\.)pinimg\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function upgradeSize(url) {
  return url.replace(/\/(236x|474x|564x)\//, '/736x/');
}

async function resolvePinImage(descriptionHtml, cache) {
  if (!descriptionHtml) return null;

  const directImage = descriptionHtml.match(PIN_IMAGE_RE);
  if (directImage && isPinterestImageHost(directImage[0])) {
    return upgradeSize(directImage[0]);
  }

  const pinLink = descriptionHtml.match(PIN_LINK_RE);
  if (!pinLink) return null;
  const url = pinLink[0];

  if (cache.has(url)) return cache.get(url);

  let image = null;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const html = await res.text();
      const original = html.match(/https:\/\/i\.pinimg\.com\/originals\/[^\s"'<>)]+/i);
      const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
      const found = original?.[0] || ogImage?.[1] || null;
      if (found && isPinterestImageHost(found)) image = upgradeSize(found);
    } else {
      console.warn(`  pin fetch ${url} responded ${res.status}`);
    }
  } catch (err) {
    console.warn(`  pin fetch ${url} failed: ${err.message}`);
  }

  cache.set(url, image);
  return image;
}

// --- Calendar fetch + occurrence expansion --------------------------------

async function loadOccurrences() {
  const data = await ical.async.fromURL(ICS_URL);
  const now = new Date();
  const windowStart = new Date(now.getTime() - PAST_DAYS * 86400000);
  const windowEnd = new Date(now.getTime() + FUTURE_DAYS * 86400000);

  const occurrences = [];

  for (const component of Object.values(data)) {
    if (component.type !== 'VEVENT') continue;
    const dateOnly = Boolean(component.start?.dateOnly);
    const duration = component.end.getTime() - component.start.getTime();
    const uidSlug = slugify(component.uid || component.summary);

    if (component.rrule) {
      const starts = component.rrule.between(windowStart, windowEnd, true);
      for (const occStart of starts) {
        const occEnd = new Date(occStart.getTime() + duration);
        occurrences.push({
          key: `${uidSlug}-${isoDateParts(occStart, dateOnly)}`,
          summary: component.summary,
          description: component.description,
          start: occStart,
          end: occEnd,
          dateOnly,
        });
      }
    } else {
      if (component.end < windowStart || component.start > windowEnd) continue;
      occurrences.push({
        key: uidSlug,
        summary: component.summary,
        description: component.description,
        start: component.start,
        end: component.end,
        dateOnly,
      });
    }
  }

  return occurrences;
}

// --- File I/O --------------------------------------------------------------

function filenameFor(key) {
  return path.join(EVENTS_DIR, `${PREFIX}${key}.yml`);
}

function existingGcalFiles() {
  return fs.readdirSync(EVENTS_DIR).filter((f) => f.startsWith(PREFIX) && /\.ya?ml$/.test(f));
}

function localDateOf(filePath) {
  try {
    const data = load(fs.readFileSync(filePath, 'utf8'));
    const raw = data?.dates?.split(',')[0] || data?.until;
    return raw ? new Date(`${raw}T12:00:00Z`) : null;
  } catch {
    return null;
  }
}

async function main() {
  const occurrences = await loadOccurrences();
  const pinCache = new Map();
  const seenKeys = new Set();
  let written = 0;
  let skippedNoImage = 0;

  for (const occ of occurrences) {
    seenKeys.add(occ.key);
    const file = filenameFor(occ.key);

    const image = await resolvePinImage(occ.description, pinCache);
    if (!image) {
      if (fs.existsSync(file)) {
        console.warn(`keeping existing card for "${occ.summary}" — no Pinterest image resolved this run`);
      } else {
        console.warn(`skipping "${occ.summary}" — no Pinterest link/image found in description`);
        skippedNoImage++;
      }
      continue;
    }

    const detail = formatDetail(occ.start, occ.end, occ.dateOnly);
    const card = {
      title: occ.summary,
      detail,
      image,
      section: 'gallery',
      schedule: 'dated',
      dates: occ.dateOnly
        ? isoDateParts(occ.start, true) === isoDateParts(inclusiveEnd(occ.start, occ.end, true), true)
          ? isoDateParts(occ.start, true)
          : `${isoDateParts(occ.start, true)},${isoDateParts(inclusiveEnd(occ.start, occ.end, true), true)}`
        : isoDateParts(occ.start, false),
    };

    const header =
      `# Auto-generated by scripts/sync-gcal-events.mjs from the ICRR Google Calendar.\n` +
      `# Do not hand-edit — the next hourly sync overwrites this file.\n` +
      `# Edit the calendar event instead: https://calendar.google.com/calendar/embed?src=${encodeURIComponent(CALENDAR_ID)}\n`;

    fs.writeFileSync(file, header + dump(card, { lineWidth: 100 }));
    written++;
  }

  let deleted = 0;
  for (const filename of existingGcalFiles()) {
    const key = filename.slice(PREFIX.length).replace(/\.ya?ml$/, '');
    if (seenKeys.has(key)) continue;

    const filePath = path.join(EVENTS_DIR, filename);
    const date = localDateOf(filePath);
    const now = new Date();
    const windowStart = new Date(now.getTime() - PAST_DAYS * 86400000);
    const windowEnd = new Date(now.getTime() + FUTURE_DAYS * 86400000);
    if (date && date >= windowStart && date <= windowEnd) {
      fs.unlinkSync(filePath);
      deleted++;
    }
  }

  console.log(
    `gcal sync: ${written} written, ${skippedNoImage} skipped (no image), ${deleted} deleted, ${occurrences.length} occurrences in window`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
