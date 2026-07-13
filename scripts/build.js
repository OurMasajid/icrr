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

// --- Decap CMS-managed content (content/events/*.yml, content/jummah.yml) ---
// Cards and Jummah fields are authored in git-backed YAML so non-developers can
// edit them via the /admin CMS. This build step renders that data into the
// static HTML at the marker comments below — the pages themselves stay plain
// HTML with no client-side templating.

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

function buildJummah() {
  const data = yaml.load(fs.readFileSync(path.join(ROOT, 'content/jummah.yml'), 'utf8'));
  const files = ['index.html', 'prayer-times.html'];
  for (const file of files) {
    const full = path.join(ROOT, file);
    let html = fs.readFileSync(full, 'utf8');
    html = html.replace(/<span data-cms="jummah\.([\w]+)">[^<]*<\/span>/g, (match, key) => {
      if (!(key in data)) throw new Error(`${file}: unknown jummah field "${key}"`);
      return `<span data-cms="jummah.${key}">${escapeHtml(data[key])}</span>`;
    });
    fs.writeFileSync(full, html);
  }
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
