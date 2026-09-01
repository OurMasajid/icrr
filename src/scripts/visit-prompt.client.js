// Asking regulars — and only regulars — to install the site and turn on
// notifications.
//
// Someone who checks prayer times a few times a week is exactly who benefits
// from ICRR sitting on their home screen with notifications on, and exactly
// who shouldn't be interrupted about it on their first visit. So this script
// keeps a count of *distinct days visited* and shows the card in
// `AppPrompt.astro` only once that count says "regular".
//
// The counting is deliberately small and entirely local: a list of
// `YYYY-MM-DD` strings in localStorage, no identifier, no cookie, no network
// call, nothing that leaves the device — clearing site data resets it. It is
// not analytics and shouldn't grow into it; if we ever want to know how many
// people visit, that's a job for the host's own stats, not for this file.
//
// The card makes up to two asks, and drops either one that's already settled:
//
// - **Install.** Where the browser offers it (Chrome/Edge/Android), the
//   deferred `beforeinstallprompt` event gives us a real one-tap install
//   button. Everywhere else — iOS Safari above all, where "Add to Home
//   Screen" is only reachable from the Share sheet — the card explains the
//   manual route instead of showing a button that can't do anything.
// - **Notifications.** Not re-implemented here: the button in the card
//   carries `data-push-button` and sits inside a `[data-push-optin]` block,
//   so `push-subscribe.client.js` binds it like any other push control, keeps
//   it in step with the header bell, and writes its progress into the card's
//   own status line. This file only watches for the "subscribed" state so it
//   knows when to stop asking.
//
// On iOS the two asks are really one: Safari exposes no Push API until the
// site is installed, so the notification half stays hidden there and the
// install copy is what carries the visitor forward.

// How much history to keep, and what counts as a regular. Roughly "showed up
// on four separate days in the last fortnight, and has been coming for at
// least a week" — a burst of curiosity over a single weekend doesn't qualify.
const HISTORY_DAYS = 60;
const WINDOW_DAYS = 14;
const REGULAR_DAYS = 4;
const SETTLING_DAYS = 7;

// Wait until they've actually settled into the page. An install pitch that
// lands while the page is still painting reads like an ad.
const DELAY_MS = 12000;

// Ignoring the card is a soft no (ask again in a fortnight); dismissing it is
// a firm one (ask again in two months). Either way we stop asking for good
// after MAX_SHOWS — a masjid site shouldn't nag.
const IGNORED_SNOOZE_DAYS = 14;
const DISMISSED_SNOOZE_DAYS = 60;
const MAX_SHOWS = 3;

const DAY_MS = 86400000;
const STORE_KEY = 'icrr:visits';
// Written by push-subscribe.client.js; its presence alongside granted
// permission is what "already subscribed" means.
const PUSH_TOKEN_KEY = 'icrr:push-token';

const card = document.querySelector('[data-app-prompt]');

// `beforeinstallprompt` fires once, early, and is lost unless it's captured
// and preventDefault()ed — so this listener is registered before any of the
// work below, not inside it.
let installEvent = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installEvent = event;
  // It can also arrive after the card is already up, in which case the manual
  // instructions can be upgraded to a real button.
  if (card && !card.hidden) renderInstallAsk();
});

// Every localStorage touch is wrapped: Safari's private mode and "block all
// cookies" both make these throw, and a visitor with storage off should get a
// site that works, not a broken one that nags.
function readState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { ...parsed, days: Array.isArray(parsed.days) ? parsed.days : [] };
  } catch {
    return { days: [] };
  }
}

function writeState(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Nothing to do — the visitor simply won't be recognised next time.
  }
}

// The visitor's own calendar day, so "visited today" means what their clock
// says rather than what UTC says.
function dayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Whole days between a stored key and today. Both ends are pinned to midday
// so a daylight-saving shift can't push a difference onto the wrong side of a
// day boundary.
function daysSince(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  if (!year || !month || !day) return Infinity;
  const then = new Date(year, month - 1, day, 12);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.round((now - then) / DAY_MS);
}

// One entry per day, however many pages get opened in it.
function recordVisit() {
  const state = readState();
  const today = dayKey();
  if (!state.first) state.first = today;
  state.days = [...new Set([...state.days, today])]
    .filter((key) => {
      const age = daysSince(key);
      // Drops both stale days and anything dated in the future, which a
      // visitor whose clock was wrong (or wound back) can leave behind.
      return age >= 0 && age <= HISTORY_DAYS;
    })
    .sort();
  writeState(state);
  return state;
}

function isRegular(state) {
  const recent = state.days.filter((key) => daysSince(key) < WINDOW_DAYS).length;
  return recent >= REGULAR_DAYS && daysSince(state.first) >= SETTLING_DAYS;
}

// Already using the installed app? Then there's nothing to install. The
// stored flag covers the other half: `appinstalled` fires in the browser tab
// they installed from, and we shouldn't pitch it again there afterwards.
function alreadyInstalled(state) {
  return Boolean(
    state.installed ||
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
  );
}

// Same feature detection push-subscribe.client.js uses, plus the two states
// where asking is pointless: permission already denied (the browser won't
// prompt again), or already subscribed.
function notificationsSettled() {
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return true;
  if (Notification.permission === 'denied') return true;
  if (Notification.permission !== 'granted') return false;
  try {
    return Boolean(localStorage.getItem(PUSH_TOKEN_KEY));
  } catch {
    return false;
  }
}

function manualInstallHint() {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, so touch points are what tell the two
  // apart.
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) {
    return 'In Safari, tap the Share button, then “Add to Home Screen”. On iPhone and iPad that’s also what lets the masjid send you notifications.';
  }
  if (/Android/.test(ua)) {
    return 'Open your browser’s menu, then “Install app” or “Add to Home screen”.';
  }
  return 'Use the install icon in your browser’s address bar, or its menu → “Install”.';
}

let installAsk;
let installButton;
let installHint;

// A real button where the browser gave us one, the manual route where it
// didn't. Called again if the deferred event turns up late.
function renderInstallAsk() {
  if (!installAsk) return;
  installButton.hidden = !installEvent;
  installHint.hidden = Boolean(installEvent);
  if (!installEvent) installHint.textContent = manualInstallHint();
}

function main() {
  const state = recordVisit();
  if (!card) return;

  if (state.done || (state.shown ?? 0) >= MAX_SHOWS) return;
  if (state.snoozeUntil && Date.now() < state.snoozeUntil) return;
  if (!isRegular(state)) return;

  installAsk = card.querySelector('[data-app-prompt-install]');
  installButton = card.querySelector('[data-app-prompt-install-button]');
  installHint = card.querySelector('[data-app-prompt-install-hint]');
  // Absent entirely on a deploy without push configured.
  const notifyAsk = card.querySelector('[data-app-prompt-notify]');

  const wantInstall = !alreadyInstalled(state);
  const wantNotify = Boolean(notifyAsk) && !notificationsSettled();

  // Installed and subscribed already: they've done everything the card would
  // have asked for, so retire it rather than re-checking on every page view.
  if (!wantInstall && !wantNotify) {
    state.done = true;
    writeState(state);
    return;
  }

  const hide = () => {
    card.classList.remove('show');
    setTimeout(() => {
      card.hidden = true;
    }, 250);
  };

  // Called after either ask is satisfied: leave the card up while the other
  // one is still open, and never come back once both are done.
  const settle = () => {
    const installLeft = wantInstall && !installAsk.hidden;
    const notifyLeft = wantNotify && !notifyAsk.hidden;
    if (installLeft || notifyLeft) return;
    const current = readState();
    current.done = true;
    writeState(current);
    hide();
  };

  const markInstalled = () => {
    const current = readState();
    current.installed = true;
    writeState(current);
    installAsk.hidden = true;
    settle();
  };

  window.addEventListener('appinstalled', markInstalled);

  installButton.addEventListener('click', async () => {
    if (!installEvent) return;
    // A deferred prompt is single-use; drop our reference before showing it so
    // a double tap can't try to reuse a spent event.
    const event = installEvent;
    installEvent = null;
    installButton.disabled = true;
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === 'accepted') {
        // `appinstalled` normally follows, but not on every browser.
        markInstalled();
        return;
      }
    } catch {
      // Fall through to the manual instructions below.
    }
    installButton.disabled = false;
    // No usable event left, so the button would be dead — show the manual
    // route in its place.
    renderInstallAsk();
  });

  // The push script owns the subscribe flow and writes its result onto the
  // panel; watching that attribute is how this file learns it succeeded
  // without either script reaching into the other.
  if (notifyAsk) {
    new MutationObserver(() => {
      if (notifyAsk.dataset.pushState !== 'subscribed') return;
      // Long enough to read the confirmation the push script just wrote.
      setTimeout(() => {
        notifyAsk.hidden = true;
        settle();
      }, 3500);
    }).observe(notifyAsk, { attributes: true, attributeFilter: ['data-push-state'] });
  }

  card.querySelectorAll('[data-app-prompt-dismiss]').forEach((button) => {
    button.addEventListener('click', () => {
      const current = readState();
      current.snoozeUntil = Date.now() + DISMISSED_SNOOZE_DAYS * DAY_MS;
      if ((current.shown ?? 0) >= MAX_SHOWS) current.done = true;
      writeState(current);
      hide();
    });
  });

  const show = () => {
    if (wantInstall) {
      installAsk.hidden = false;
      renderInstallAsk();
    }
    if (wantNotify) notifyAsk.hidden = false;
    card.hidden = false;
    // Force a layout read, or the freshly-unhidden card jumps straight to its
    // final style and the fade-in never runs (same trick as the push toast).
    void card.offsetWidth;
    card.classList.add('show');

    // Counted at the moment it's seen, not when it's answered: a card shown
    // and ignored is still an ask, and shouldn't be repeated tomorrow.
    const current = readState();
    current.shown = (current.shown ?? 0) + 1;
    current.snoozeUntil = Date.now() + IGNORED_SNOOZE_DAYS * DAY_MS;
    writeState(current);
  };

  const schedule = () => {
    // A background tab shouldn't burn its one ask on a page nobody is looking
    // at; wait until it's actually on screen.
    if (document.visibilityState !== 'visible') {
      document.addEventListener('visibilitychange', schedule, { once: true });
      return;
    }
    setTimeout(show, DELAY_MS);
  };

  schedule();
}

main();
