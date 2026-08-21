// Where the push opt-in's Firebase config comes from.
//
// Two places offer the opt-in — the header bell (`NotificationBell.astro`,
// on every page via `Nav.astro`) and the homepage panel
// (`NotificationOptIn.astro`) — and both need the same answer to "is push
// configured for this deploy?", so the question is answered once here.
//
// The FCM config is public by design (it ships in every browser bundle), but
// it isn't committed — set these as environment variables in the host's UI.
// PUBLIC_ is Astro's prefix for build-time values that may reach the client.
//
// PUBLIC_FIREBASE_API_KEY             Firebase console → Project settings → General
// PUBLIC_FIREBASE_AUTH_DOMAIN         ditto
// PUBLIC_FIREBASE_PROJECT_ID          ditto
// PUBLIC_FIREBASE_MESSAGING_SENDER_ID ditto
// PUBLIC_FIREBASE_APP_ID              ditto
// PUBLIC_FIREBASE_VAPID_KEY           Project settings → Cloud Messaging →
//                                     Web configuration → Web Push certificates
const env = import.meta.env;

export const pushFirebaseConfig = {
  apiKey: env.PUBLIC_FIREBASE_API_KEY,
  authDomain: env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.PUBLIC_FIREBASE_APP_ID,
  vapidKey: env.PUBLIC_FIREBASE_VAPID_KEY,
};

// Until every value above is set, nothing push-related renders: a visible
// "Enable notifications" control that can't mint a token is worse than no
// control at all.
export const pushConfigured = Object.values(pushFirebaseConfig).every(Boolean);

// Where the token is registered and broadcasts are composed. Override with
// PUBLIC_OURMASAJID_API when testing against a local Our Masajid.
export const pushApiBase = env.PUBLIC_OURMASAJID_API ?? 'https://ourmasajid.com';

export const pushSlug = 'icrr';
