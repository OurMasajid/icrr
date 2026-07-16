#!/usr/bin/env node
// Builds Tailwind CSS and minifies JS into content-hashed files, then rewrites
// the <link>/<script> references across every HTML page. Content hashing means
// a new deploy is always served from a brand-new URL, so browsers and any CDN
// (e.g. Cloudflare) in front of the site never serve a stale asset — the old
// hashed file simply stops being referenced.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');

function hashOf(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
}

function removeStaleBuilds(pattern, keepFile) {
  for (const name of fs.readdirSync(ROOT)) {
    if (pattern.test(name) && name !== keepFile) {
      fs.unlinkSync(path.join(ROOT, name));
    }
  }
}

function buildCss() {
  const tmp = path.join(ROOT, '.tailwind-tmp.css');
  const cli = require.resolve('tailwindcss/lib/cli.js');
  execFileSync(
    process.execPath,
    [cli, '-i', 'src/input.css', '-o', tmp, '--minify'],
    { cwd: ROOT, stdio: 'inherit' }
  );
  const css = fs.readFileSync(tmp, 'utf8');
  fs.unlinkSync(tmp);
  const outName = `styles.${hashOf(css)}.css`;
  removeStaleBuilds(/^styles\.[0-9a-f]{10}\.css$/, outName);
  fs.writeFileSync(path.join(ROOT, outName), css);
  return outName;
}

function buildJs(srcRelPath, baseName) {
  const src = fs.readFileSync(path.join(ROOT, srcRelPath), 'utf8');
  const { code } = esbuild.transformSync(src, { minify: true, loader: 'js' });
  const outName = `${baseName}.${hashOf(code)}.js`;
  removeStaleBuilds(new RegExp(`^${baseName}\\.[0-9a-f]{10}\\.js$`), outName);
  fs.writeFileSync(path.join(ROOT, outName), code);
  return outName;
}

function rewriteHtml(replacements) {
  const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  for (const file of htmlFiles) {
    const full = path.join(ROOT, file);
    let html = fs.readFileSync(full, 'utf8');
    let changed = false;
    for (const { pattern, replacement } of replacements) {
      const next = html.replace(pattern, replacement);
      if (next !== html) changed = true;
      html = next;
    }
    if (changed) fs.writeFileSync(full, html);
  }
}

// --- CMS-managed content (content/events/*.yml, content/jummah.yml) ---
// Cards and Jummah fields are authored in git-backed YAML so non-developers can
// edit them via Pages CMS (see .pages.yml). This build step renders that data
// into the static HTML at the marker comments below — the pages themselves
// stay plain HTML with no client-side templating.

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadEvents() {
  const dir = path.join(ROOT, 'content/events');
  const events = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => {
      const data = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
      const err = (msg) => { throw new Error(`content/events/${f}: ${msg}`); };
      if (!data.title) err('missing "title"');
      if (!data.image) err('missing "image"');
      if (data.schedule === 'dated' && !/^\d{4}-\d{2}-\d{2}(,\d{4}-\d{2}-\d{2})*$/.test(data.dates || ''))
        err('schedule "dated" requires "dates" as YYYY-MM-DD or comma-separated YYYY-MM-DD dates');
      if (data.schedule === 'ongoing' && !/^\d{4}-\d{2}-\d{2}$/.test(data.until || ''))
        err('schedule "ongoing" requires "until" as YYYY-MM-DD');
      if (!['gallery', 'weekly'].includes(data.section)) err('"section" must be "gallery" or "weekly"');
      return { ...data, _file: f };
    });
  events.sort((a, b) => (a.order || 0) - (b.order || 0));
  return events;
}

function dateAttr(ev) {
  if (ev.schedule === 'dated') return ` data-event-date="${ev.dates}"`;
  if (ev.schedule === 'ongoing') return ` data-event-until="${ev.until}"`;
  return '';
}

function renderEventCard(ev, { homepage }) {
  const chipClass = ev.chip_style === 'gold' ? 'chip chip-gold' : 'chip';
  const alt = escapeHtml(`${ev.title} — ${ev.detail}`);
  const link = homepage
    ? `<a href="events.html" class="event-flyer-img-wrap">`
    : `<a href="${escapeHtml(ev.image)}" target="_blank" class="event-flyer-img-wrap">`;
  let attrs = dateAttr(ev);
  if (homepage && ev.schedule === 'none' && ev.homepage_day !== undefined && ev.homepage_day !== null) {
    attrs = ` data-event-day="${ev.homepage_day}"`;
  }
  return `      <div class="event-flyer-card"${attrs}>
        ${link}
          <img src="${escapeHtml(ev.image)}" alt="${alt}" loading="lazy" />
        </a>
        <div class="event-flyer-info">
          <span class="${chipClass}">${escapeHtml(ev.chip)}</span>
          <h3 class="font-display text-lg mt-2">${escapeHtml(ev.title)}</h3>
          <p class="text-sm text-slate-500 mt-1">${escapeHtml(ev.detail)}</p>
        </div>
      </div>`;
}

function injectMarker(file, marker, html) {
  const full = path.join(ROOT, file);
  const src = fs.readFileSync(full, 'utf8');
  const pattern = new RegExp(`<!-- CMS:${marker}:START -->[\\s\\S]*?<!-- CMS:${marker}:END -->`);
  if (!pattern.test(src)) throw new Error(`${file}: marker CMS:${marker} not found`);
  const next = src.replace(pattern, `<!-- CMS:${marker}:START -->\n${html}\n      <!-- CMS:${marker}:END -->`);
  fs.writeFileSync(full, next);
}

function buildEvents() {
  const events = loadEvents();
  const gallery = events.filter((e) => e.section === 'gallery');
  const weekly = events.filter((e) => e.section === 'weekly');
  const onHomepage = events.filter((e) => e.show_on_homepage);

  injectMarker('events.html', 'EVENTS_GALLERY', gallery.map((e) => renderEventCard(e, { homepage: false })).join('\n\n'));
  injectMarker('events.html', 'EVENTS_WEEKLY', weekly.map((e) => renderEventCard(e, { homepage: false })).join('\n\n'));
  injectMarker('index.html', 'EVENTS_HOMEPAGE', onHomepage.map((e) => renderEventCard(e, { homepage: true })).join('\n\n'));
}

const JUMMAH_DONATION_LINK_FULL = `<a href="https://us.mohid.co/tx/austin/icrr/masjid/online/donation" target="_blank" rel="noopener" class="btn btn-gold mt-4">Virtual Friday Donation Box</a>`;
const JUMMAH_DONATION_LINK_BLOCK = `<a href="https://us.mohid.co/tx/austin/icrr/masjid/online/donation" target="_blank" rel="noopener" class="btn btn-gold mt-4 w-full justify-center">Virtual Friday Donation Box</a>`;

// If both Jumu'ahs share the same khutbah title and khateeb, show a single
// combined block instead of duplicating identical info twice.
function jummahSameTopic(d) {
  return d.first_khutbah_title === d.second_khutbah_title
    && d.first_khateeb === d.second_khateeb;
}

function renderJummahHero(d, same) {
  const e = escapeHtml;
  if (same) {
    return `      <div class="jummah-hero-header text-center">
        <p class="uppercase text-xs tracking-widest text-emerald-200 mt-3">This Week's Khutbah</p>
        <h3 class="font-display text-2xl md:text-3xl font-bold text-white mt-2 leading-tight">"${e(d.first_khutbah_title)}"</h3>
        <p class="text-emerald-50 text-lg mt-2">by <strong class="text-white">${e(d.first_khateeb)}</strong></p>
      </div>
      <div class="jummah-hero-body">
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-xl bg-white/10 px-4 py-3 text-center">
            <p class="text-xs font-bold uppercase tracking-wider text-emerald-200">1st Jumuʿah</p>
            <p class="font-display text-2xl text-white mt-1">${e(d.first_time)}</p>
          </div>
          <div class="rounded-xl bg-white/10 px-4 py-3 text-center">
            <p class="text-xs font-bold uppercase tracking-wider text-emerald-200">2nd Jumuʿah</p>
            <p class="font-display text-2xl text-white mt-1">${e(d.second_time)}</p>
          </div>
        </div>
        ${JUMMAH_DONATION_LINK_BLOCK}
      </div>`;
  }
  return `      <div class="jummah-hero-header text-center">
        <p class="uppercase text-xs tracking-widest text-emerald-200 mt-3">This Week's Khutbahs</p>
      </div>
      <div class="jummah-hero-body">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="rounded-xl bg-white/10 px-4 py-3 text-center">
            <p class="text-xs font-bold uppercase tracking-wider text-emerald-200">1st Jumuʿah</p>
            <p class="font-display text-2xl text-white mt-1">${e(d.first_time)}</p>
            <h3 class="font-display text-base font-bold text-white mt-3 leading-tight">"${e(d.first_khutbah_title)}"</h3>
            <p class="text-emerald-50 text-sm mt-2">by <strong class="text-white">${e(d.first_khateeb)}</strong></p>
          </div>
          <div class="rounded-xl bg-white/10 px-4 py-3 text-center">
            <p class="text-xs font-bold uppercase tracking-wider text-emerald-200">2nd Jumuʿah</p>
            <p class="font-display text-2xl text-white mt-1">${e(d.second_time)}</p>
            <h3 class="font-display text-base font-bold text-white mt-3 leading-tight">"${e(d.second_khutbah_title)}"</h3>
            <p class="text-emerald-50 text-sm mt-2">by <strong class="text-white">${e(d.second_khateeb)}</strong></p>
          </div>
        </div>
        ${JUMMAH_DONATION_LINK_BLOCK}
      </div>`;
}

function renderJummahBanner(d, same) {
  const e = escapeHtml;
  if (same) {
    return `    <div class="text-center">
      <span class="chip chip-gold text-base px-4 py-1.5">Today is Jumuʿah</span>
      <p class="uppercase text-xs tracking-widest text-emerald-200 mt-5">This Week's Khutbah</p>
      <h2 class="font-display text-3xl md:text-5xl font-bold text-white mt-2 leading-tight">"${e(d.first_khutbah_title)}"</h2>
      <p class="text-emerald-50 text-xl mt-4">by <strong class="text-white">${e(d.first_khateeb)}</strong></p>
    </div>
    <div class="flex justify-center gap-4 md:gap-6 mt-8">
      <div class="jummah-time-card">
        <p class="text-xs font-bold uppercase tracking-wider text-emerald-200">1st Jumuʿah</p>
        <p class="font-display text-3xl md:text-4xl text-white mt-1">${e(d.first_time)}</p>
      </div>
      <div class="jummah-time-card">
        <p class="text-xs font-bold uppercase tracking-wider text-emerald-200">2nd Jumuʿah</p>
        <p class="font-display text-3xl md:text-4xl text-white mt-1">${e(d.second_time)}</p>
      </div>
    </div>
    <div class="text-center mt-6">
      <p class="text-emerald-100/80 text-sm">Salah immediately after khutbah. Please arrive early.</p>
      ${JUMMAH_DONATION_LINK_FULL}
    </div>`;
  }
  return `    <div class="text-center">
      <span class="chip chip-gold text-base px-4 py-1.5">Today is Jumuʿah</span>
      <p class="uppercase text-xs tracking-widest text-emerald-200 mt-5">This Week's Khutbahs</p>
    </div>
    <div class="flex flex-col sm:flex-row justify-center gap-4 md:gap-6 mt-8">
      <div class="jummah-time-card">
        <p class="text-xs font-bold uppercase tracking-wider text-emerald-200">1st Jumuʿah</p>
        <p class="font-display text-3xl md:text-4xl text-white mt-1">${e(d.first_time)}</p>
        <h3 class="font-display text-lg md:text-xl font-bold text-white mt-3 leading-tight">"${e(d.first_khutbah_title)}"</h3>
        <p class="text-emerald-50 mt-2">by <strong class="text-white">${e(d.first_khateeb)}</strong></p>
      </div>
      <div class="jummah-time-card">
        <p class="text-xs font-bold uppercase tracking-wider text-emerald-200">2nd Jumuʿah</p>
        <p class="font-display text-3xl md:text-4xl text-white mt-1">${e(d.second_time)}</p>
        <h3 class="font-display text-lg md:text-xl font-bold text-white mt-3 leading-tight">"${e(d.second_khutbah_title)}"</h3>
        <p class="text-emerald-50 mt-2">by <strong class="text-white">${e(d.second_khateeb)}</strong></p>
      </div>
    </div>
    <div class="text-center mt-6">
      <p class="text-emerald-100/80 text-sm">Salah immediately after khutbah. Please arrive early.</p>
      ${JUMMAH_DONATION_LINK_FULL}
    </div>`;
}

function renderJummahSidebar(d, same) {
  const e = escapeHtml;
  const footer = `<p class="text-slate-500 mt-3 text-sm">Salah immediately after khutbah. Please arrive early — overflow parking opens 40 min prior.</p>
        ${JUMMAH_DONATION_LINK_BLOCK}`;
  if (same) {
    return `        <p class="text-xs uppercase tracking-wider text-brand font-bold mt-4">This Week's Khutbah</p>
        <p class="font-display text-lg font-bold text-slate-900 mt-1">"${e(d.first_khutbah_title)}"</p>
        <p class="text-slate-700 mt-2"><strong>Imam:</strong> ${e(d.first_khateeb)}</p>
        <div class="mt-4 grid grid-cols-2 gap-3">
          <div class="rounded-xl bg-brand-soft px-4 py-3 text-center">
            <p class="text-xs font-bold uppercase tracking-wider text-brand-deep">1st Jumuʿah</p>
            <p class="font-display text-xl text-brand-deep mt-1">${e(d.first_time)}</p>
          </div>
          <div class="rounded-xl bg-brand-soft px-4 py-3 text-center">
            <p class="text-xs font-bold uppercase tracking-wider text-brand-deep">2nd Jumuʿah</p>
            <p class="font-display text-xl text-brand-deep mt-1">${e(d.second_time)}</p>
          </div>
        </div>
        ${footer}`;
  }
  return `        <p class="text-xs uppercase tracking-wider text-brand font-bold mt-4">This Week's Khutbahs</p>
        <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="rounded-xl bg-brand-soft px-4 py-3 text-center">
            <p class="text-xs font-bold uppercase tracking-wider text-brand-deep">1st Jumuʿah</p>
            <p class="font-display text-xl text-brand-deep mt-1">${e(d.first_time)}</p>
            <p class="font-display text-sm font-bold text-slate-900 mt-2">"${e(d.first_khutbah_title)}"</p>
            <p class="text-slate-700 text-sm mt-1"><strong>Imam:</strong> ${e(d.first_khateeb)}</p>
          </div>
          <div class="rounded-xl bg-brand-soft px-4 py-3 text-center">
            <p class="text-xs font-bold uppercase tracking-wider text-brand-deep">2nd Jumuʿah</p>
            <p class="font-display text-xl text-brand-deep mt-1">${e(d.second_time)}</p>
            <p class="font-display text-sm font-bold text-slate-900 mt-2">"${e(d.second_khutbah_title)}"</p>
            <p class="text-slate-700 text-sm mt-1"><strong>Imam:</strong> ${e(d.second_khateeb)}</p>
          </div>
        </div>
        ${footer}`;
}

function buildJummah() {
  const data = yaml.load(fs.readFileSync(path.join(ROOT, 'content/jummah.yml'), 'utf8'));
  const same = jummahSameTopic(data);
  injectMarker('index.html', 'JUMMAH_HERO', renderJummahHero(data, same));
  injectMarker('prayer-times.html', 'JUMMAH_BANNER', renderJummahBanner(data, same));
  injectMarker('prayer-times.html', 'JUMMAH_SIDEBAR', renderJummahSidebar(data, same));
}

buildEvents();
buildJummah();

const cssFile = buildCss();
const prayerTimesJsFile = buildJs('src/prayer-times.js', 'prayer-times');

rewriteHtml([
  { pattern: /href="styles(?:\.[0-9a-f]{10})?\.css"/g, replacement: `href="${cssFile}"` },
  { pattern: /src="prayer-times(?:\.[0-9a-f]{10})?\.js"/g, replacement: `src="${prayerTimesJsFile}"` },
]);

console.log(`Built ${cssFile} and ${prayerTimesJsFile}`);
