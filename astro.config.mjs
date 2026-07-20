import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://roundrockmasjid.org',
  trailingSlash: 'never',
  build: {
    // Keep exact `/about.html` style URLs (matches sitemap.xml, canonical
    // tags, and existing inbound links) instead of Astro's default
    // `/about/` directory-style routing.
    format: 'file',
  },
});
