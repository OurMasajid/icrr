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

const cssFile = buildCss();
const prayerTimesJsFile = buildJs('src/prayer-times.js', 'prayer-times');

rewriteHtml([
  { pattern: /href="styles(?:\.[0-9a-f]{10})?\.css"/g, replacement: `href="${cssFile}"` },
  { pattern: /src="prayer-times(?:\.[0-9a-f]{10})?\.js"/g, replacement: `src="${prayerTimesJsFile}"` },
]);

console.log(`Built ${cssFile} and ${prayerTimesJsFile}`);
