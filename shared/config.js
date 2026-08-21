// ─── Trawley Coin configuration ──────────────────────────────────────────────
//
// DEMO MODE (default): leave this as null. Everything works on one device —
// open the Parent app and Kid app in two tabs/windows of the same browser and
// they stay in sync live.
//
// LIVE FAMILY SYNC (parent's phone <-> kid's phone): create a free Firebase
// project (see README.md, ~5 minutes), then paste its config object below.
//
window.TRAWLEY_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDvVimcQxuhXRbHCvGM1JAH-C-qGaafE2Q",
  authDomain: "trawley-coin.firebaseapp.com",
  projectId: "trawley-coin",
  storageBucket: "trawley-coin.firebasestorage.app",
  messagingSenderId: "123877573737",
  appId: "1:123877573737:web:ebf9d4a5a16d257d538ef8"
};

/* Example — replace null above with your own values from the Firebase console:

window.TRAWLEY_FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "trawley-coin.firebaseapp.com",
  projectId: "trawley-coin",
  storageBucket: "trawley-coin.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123"
};

*/
