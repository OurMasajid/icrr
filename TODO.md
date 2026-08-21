# TODO

## Set up push notifications

The header notification bell (`src/components/NotificationBell.astro`) and
the homepage's "Get notifications on your phone" panel
(`src/components/NotificationOptIn.astro`) only render when every
`PUBLIC_FIREBASE_*` env var below is set — an unconfigured deploy shows
nothing instead of a broken button. All values are public (they ship in the
browser bundle) and none are secrets; the service account that actually
sends notifications lives in the Our Masajid app.

Set these in the host's env-var UI (Netlify: Site configuration →
Environment variables; GitHub Pages: repo Actions → Secrets and variables →
Actions):

- `PUBLIC_FIREBASE_API_KEY`
- `PUBLIC_FIREBASE_AUTH_DOMAIN`
- `PUBLIC_FIREBASE_PROJECT_ID`
- `PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `PUBLIC_FIREBASE_APP_ID`

Get all five from Firebase console → Project settings → General → Your
apps → Web app.

- `PUBLIC_FIREBASE_VAPID_KEY`

Get from Firebase console → Project settings → Cloud Messaging → Web
configuration → Web Push certificates → "Key pair". Not the same as any
VAPID key in the Our Masajid repo.

- `PUBLIC_OURMASAJID_API` *(optional)*

Where registration tokens are sent to be subscribed to the `icrr-all`
topic. Defaults to `https://ourmasajid.com`; only override for local
testing.

For local dev, copy `.env.example` to `.env` and fill in the same values.

## Move hosting from Netlify to GitHub Pages

Pure static Astro build (`build.format: 'file'` → flat `.html` in `dist/`),
so GH Pages can serve it directly. Same custom domain
(`roundrockmasjid.org`) keeps existing FCM push subscriptions valid — origin
identity is what tokens are tied to, not the host.

Blockers in `netlify.toml` to resolve first:

- **`/api/pinterest-board` rewrite** — Netlify server-side proxies
  Pinterest's RSS so the browser can fetch it same-origin. GH Pages has no
  rewrites. Replace with a build-time fetch (a step in the GH Actions
  workflow writes the RSS to `dist/api/pinterest-board.xml`), a Cloudflare
  Worker, or drop the feature.
- **Custom response headers** — CSP-ish headers (`X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS) and cache-control for
  `/_astro/*` and `/images/*`. GH Pages can't set headers. HSTS on a
  custom-domain GH Pages site is on by default, and Astro's content-hashed
  `/_astro/*` assets are already cached well by browsers; if the security
  headers are non-negotiable, put Cloudflare in front.
- **www → apex redirect** — handled by GH Pages / DNS when the custom
  domain is configured (set `roundrockmasjid.org` as the primary in repo
  Pages settings; add both A/AAAA for apex and a CNAME for www at the DNS
  provider).

Migration steps:

1. Add `public/CNAME` containing `roundrockmasjid.org`.
2. Add `.github/workflows/pages.yml` — `actions/checkout` → setup Node 22
   → `npm ci` → `npm run build` → `actions/upload-pages-artifact` on
   `dist/` → `actions/deploy-pages`. Trigger on push to the default
   branch.
3. Set all `PUBLIC_FIREBASE_*` values (and optional `PUBLIC_OURMASAJID_API`)
   as GitHub Actions repo secrets/variables, and inject them into the
   build step's `env:` block.
4. Replace or drop the Pinterest proxy per above.
5. In GitHub repo Settings → Pages, set source to "GitHub Actions" and
   the custom domain to `roundrockmasjid.org` (enable "Enforce HTTPS").
6. Update DNS: apex A/AAAA records to GH Pages IPs, `www` CNAME to
   `<owner>.github.io`.
7. Cut over, verify the site, then delete `netlify.toml` and disable the
   Netlify site.
