// Push-notification opt-in.
//
// The browser SDK can mint an FCM registration token but can't join a topic —
// that's a server-side call — so the token is handed to Our Masajid, which
// subscribes it to this masjid's broadcast topic (`icrr-all`) and later sends
// to that topic. See src/app/api/masajid/[slug]/push-tokens in that repo.
//
// Any number of controls on the page can start the flow: the header bell
// (every page) and the homepage panel's button both carry `data-push-button`,
// and all of them are kept in the same state so the bell doesn't still read
// "Enable notifications" after the panel below it has been switched on.
//
// The Firebase SDK is imported dynamically rather than at the top of the
// file: it's by far the heaviest dependency on the site, and most visitors
// never tap a button. Keeping it behind `await loadFirebase()` means the
// chunk is only fetched when someone actually opts in.

// Rendered once per page by BaseLayout, and only on a deploy where every
// PUBLIC_FIREBASE_* value is set — so its absence means "push isn't
// configured here", and there's nothing to wire up.
const configEl = document.querySelector('[data-push-config]');
const buttons = Array.from(document.querySelectorAll('[data-push-button]'));

// Remembering the token is what lets a returning visitor see "You're
// subscribed" and unsubscribe without re-prompting for permission.
const STORAGE_KEY = 'icrr:push-token';

if (configEl && buttons.length) {
  const panels = Array.from(document.querySelectorAll('[data-push-optin]'));
  const statuses = Array.from(document.querySelectorAll('[data-push-status]'));

  const config = {
    apiKey: configEl.dataset.apiKey,
    authDomain: configEl.dataset.authDomain,
    projectId: configEl.dataset.projectId,
    messagingSenderId: configEl.dataset.messagingSenderId,
    appId: configEl.dataset.appId,
  };
  const vapidKey = configEl.dataset.vapidKey;
  const endpoint = `${configEl.dataset.apiBase}/api/masajid/${configEl.dataset.slug}/push-tokens`;

  // A bell tapped in the header has no status line near it — the panel it
  // belongs to is at the bottom of the homepage, or on another page
  // entirely — so those clicks get a toast instead. Set per click.
  let announce = false;
  let toast;
  let toastTimer;

  const showToast = (message) => {
    if (!message) return;
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'push-toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    // Force a layout read first: without it a freshly-appended node goes
    // straight to its final style and the fade-in never runs.
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 6000);
  };

  const setStatus = (message) => {
    statuses.forEach((el) => {
      el.textContent = message;
    });
    if (announce) showToast(message);
  };

  const setButtons = (label, { disabled = false, on = false } = {}) => {
    buttons.forEach((button) => {
      const text = button.querySelector('[data-push-button-label]');
      if (text) {
        text.textContent = label;
      } else {
        // Icon-only control (the header bell): the label is its accessible
        // name and its tooltip.
        button.setAttribute('aria-label', label);
        button.title = label;
      }
      button.disabled = disabled;
      button.toggleAttribute('data-push-on', on);
    });
  };

  const send = (method, token) =>
    fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

  const showSubscribed = () => {
    panels.forEach((panel) => {
      panel.dataset.pushState = 'subscribed';
    });
    setButtons('Turn off notifications', { on: true });
    setStatus("You're subscribed. We'll let you know about prayer changes, events, and announcements.");
  };

  const showIdle = () => {
    panels.forEach((panel) => {
      panel.dataset.pushState = 'idle';
    });
    setButtons('Enable notifications');
    setStatus('');
  };

  const subscribed = () => panels[0]?.dataset.pushState === 'subscribed'
    || buttons[0]?.hasAttribute('data-push-on');

  let firebase;
  async function loadFirebase() {
    if (!firebase) {
      const [app, messaging] = await Promise.all([
        import('firebase/app'),
        import('firebase/messaging'),
      ]);
      firebase = { ...app, ...messaging };
    }
    return firebase;
  }

  async function messagingInstance(fb) {
    const app = fb.getApps()[0] ?? fb.initializeApp(config);
    return fb.getMessaging(app);
  }

  async function subscribe() {
    setButtons('Enabling…', { disabled: true });
    setStatus('');

    const fb = await loadFirebase();
    // A more thorough check than the feature detection below — it also covers
    // browsers where IndexedDB is unavailable, which the SDK requires.
    if (!(await fb.isSupported().catch(() => false))) {
      hideControls();
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setButtons('Enable notifications');
      setStatus(
        permission === 'denied'
          ? 'Notifications are blocked for this site. Enable them in your browser settings, then try again.'
          : 'Notifications were not enabled.'
      );
      return;
    }

    // Registering explicitly (rather than letting the SDK look for
    // /firebase-messaging-sw.js itself) keeps the path under our control and
    // lets us await activation before asking for a token.
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;

    const token = await fb.getToken(await messagingInstance(fb), {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) throw new Error('No registration token returned');

    const response = await send('POST', token);
    if (!response.ok) throw new Error(`Subscribe failed (${response.status})`);

    localStorage.setItem(STORAGE_KEY, token);
    showSubscribed();
  }

  async function unsubscribe() {
    setButtons('Turning off…', { disabled: true, on: true });
    const token = localStorage.getItem(STORAGE_KEY);

    if (token) {
      // Drop the topic subscription first: deleteToken() below invalidates
      // the token, and the server needs it to identify the subscription.
      await send('DELETE', token).catch(() => {});
      try {
        const fb = await loadFirebase();
        await fb.deleteToken(await messagingInstance(fb));
      } catch {
        // The token may already be gone (site data cleared, FCM rotated it).
        // The server-side removal above is the part that matters.
      }
    }

    localStorage.removeItem(STORAGE_KEY);
    showIdle();
    setStatus('Notifications are off.');
  }

  function hideControls() {
    [...panels, ...buttons].forEach((el) => {
      el.hidden = true;
    });
  }

  // Cheap feature detection so the controls can be hidden without paying for
  // the Firebase chunk. Covers iOS Safari outside an installed PWA, where the
  // Push API is absent.
  const maybeSupported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  if (!maybeSupported) {
    hideControls();
  } else {
    if (Notification.permission === 'granted' && localStorage.getItem(STORAGE_KEY)) {
      showSubscribed();
    } else {
      showIdle();
    }

    buttons.forEach((button) => {
      button.addEventListener('click', async () => {
        // Panel clicks land next to the panel's own status line; anything
        // else needs the toast to say what happened.
        announce = !button.closest('[data-push-optin]');
        const wasSubscribed = subscribed();
        try {
          if (wasSubscribed) {
            await unsubscribe();
          } else {
            await subscribe();
          }
        } catch (error) {
          console.error('[push]', error);
          if (wasSubscribed) {
            showSubscribed();
          } else {
            setButtons('Enable notifications');
          }
          setStatus('Something went wrong setting up notifications. Please try again.');
        }
      });
    });
  }
}
