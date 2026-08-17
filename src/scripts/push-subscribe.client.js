// Push-notification opt-in.
//
// The browser SDK can mint an FCM registration token but can't join a topic —
// that's a server-side call — so the token is handed to Our Masajid, which
// subscribes it to this masjid's broadcast topic (`icrr-all`) and later sends
// to that topic. See src/app/api/masajid/[slug]/push-tokens in that repo.
//
// The Firebase SDK is imported dynamically rather than at the top of the
// file: it's by far the heaviest dependency on the site, and most visitors
// never tap the button. Keeping it behind `await loadFirebase()` means the
// chunk is only fetched when someone actually opts in.

const panel = document.querySelector('[data-push-optin]');

// Remembering the token is what lets a returning visitor see "You're
// subscribed" and unsubscribe without re-prompting for permission.
const STORAGE_KEY = 'icrr:push-token';

if (panel) {
  const button = panel.querySelector('[data-push-button]');
  const status = panel.querySelector('[data-push-status]');

  const config = {
    apiKey: panel.dataset.apiKey,
    authDomain: panel.dataset.authDomain,
    projectId: panel.dataset.projectId,
    messagingSenderId: panel.dataset.messagingSenderId,
    appId: panel.dataset.appId,
  };
  const vapidKey = panel.dataset.vapidKey;
  const endpoint = `${panel.dataset.apiBase}/api/masajid/${panel.dataset.slug}/push-tokens`;

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const setButton = (label, disabled) => {
    if (!button) return;
    button.textContent = label;
    button.disabled = Boolean(disabled);
  };

  const send = (method, token) =>
    fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

  const showSubscribed = () => {
    panel.dataset.pushState = 'subscribed';
    setButton('Turn off notifications', false);
    setStatus("You're subscribed. We'll let you know about prayer changes, events, and announcements.");
  };

  const showIdle = () => {
    panel.dataset.pushState = 'idle';
    setButton('Enable notifications', false);
    setStatus('');
  };

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
    setButton('Enabling…', true);
    setStatus('');

    const fb = await loadFirebase();
    // A more thorough check than the feature detection below — it also covers
    // browsers where IndexedDB is unavailable, which the SDK requires.
    if (!(await fb.isSupported().catch(() => false))) {
      panel.hidden = true;
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setButton('Enable notifications', false);
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
    setButton('Turning off…', true);
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
  }

  // Cheap feature detection so the panel can be hidden without paying for the
  // Firebase chunk. Covers iOS Safari outside an installed PWA, where the
  // Push API is absent.
  const maybeSupported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  if (!maybeSupported) {
    panel.hidden = true;
  } else {
    if (Notification.permission === 'granted' && localStorage.getItem(STORAGE_KEY)) {
      showSubscribed();
    } else {
      showIdle();
    }

    button?.addEventListener('click', async () => {
      const wasSubscribed = panel.dataset.pushState === 'subscribed';
      try {
        if (wasSubscribed) {
          await unsubscribe();
        } else {
          await subscribe();
        }
      } catch (error) {
        console.error('[push]', error);
        setButton(wasSubscribed ? 'Turn off notifications' : 'Enable notifications', false);
        setStatus('Something went wrong setting up notifications. Please try again.');
      }
    });
  }
}
