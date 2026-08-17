/* Service worker for ICRR push notifications.
 *
 * Deliberately plain JS with no Firebase SDK: this file lives in public/ so
 * Astro copies it verbatim (no bundling, no env substitution), and the usual
 * `importScripts('https://www.gstatic.com/firebasejs/...')` would put a
 * third-party fetch on the critical path of every push.
 *
 * It doesn't need the SDK. Broadcasts are sent as FCM *data-only* messages
 * (see sendToTopic() in the Our Masajid repo), which arrive here as an
 * ordinary Web Push event for us to render ourselves. The upside is that the
 * link a tap opens comes from the message payload, so notifications sent from
 * the Our Masajid admin open roundrockmasjid.org rather than ourmasajid.com.
 *
 * The name is kept as firebase-messaging-sw.js because that's the path the
 * Firebase JS SDK registers by default.
 */

const FALLBACK_URL = '/';
const ICON = '/images/logo.png';

// Take over as soon as a new version is deployed rather than waiting for
// every tab to close — a stale push handler is worse than a brief overlap.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/**
 * FCM nests a data-only message under `data`, but a message sent by other
 * means (or a future notification-style send) puts the same fields at the top
 * level. Accept either rather than silently showing an empty notification.
 */
function readPayload(event) {
  if (!event.data) return {};
  let raw;
  try {
    raw = event.data.json();
  } catch {
    return { title: event.data.text() };
  }
  return raw.data || raw.notification || raw || {};
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  const title = payload.title || 'Islamic Center of Round Rock';

  // Chrome shows its own "This site has been updated in the background"
  // notice if a push handler finishes without showing anything, so always
  // show something.
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: payload.icon || ICON,
      badge: ICON,
      // Collapse repeats of the same broadcast rather than stacking them.
      tag: payload.tag || 'icrr-all',
      data: { link: payload.link || payload.click_action || FALLBACK_URL },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || FALLBACK_URL;
  const target = new URL(link, self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Reuse a tab already on this page instead of opening a duplicate.
      for (const client of windows) {
        if (client.url === target.href && 'focus' in client) return client.focus();
      }
      // Otherwise reuse any open tab of the site, falling back to a new one.
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'navigate' in client) {
          return client.navigate(target.href).then((c) => (c ? c.focus() : null));
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});
