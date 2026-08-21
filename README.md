# 🪙 Trawley Coin

The family chore currency — a live-syncing PWA with **two installable apps**:

| App | URL | Who | What it does |
|-----|-----|-----|--------------|
| **Parent** | `/parent/` | You | Approve chore messages, choose how many coins to award, create/edit chores with set coin values, add/spend coins, PIN lock |
| **Kid** | `/kid/` | Your kid | See their Trawley Coin balance, tap a chore to message you "I did it!", send custom messages, get a 🎉 when you approve |

Both apps share one live database, so an approval on your phone updates the kid's
balance on their screen instantly.

## Try it right now (demo mode)

```bash
python3 -m http.server 8788
```

Then open **http://localhost:8788** and pick an app. Open the Parent app and the
Kid app in two windows side by side — send a chore from the kid, approve it as
the parent, and watch the balance jump.

Demo mode stores everything in that browser only (synced live across its tabs).
It's perfect for trying the app on one device.

## Real family sync (parent's phone ↔ kid's phone)

For the two phones to share one live database you connect the free tier of
Google Firebase (~5 minutes, no credit card):

1. Go to <https://console.firebase.google.com> → **Add project** (call it
   `trawley-coin`; Analytics off is fine).
2. In the project: **Build → Firestore Database → Create database** → Start in
   **production mode** → pick a region near you (e.g. `australia-southeast1`).
3. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
4. Firestore → **Rules** tab → replace with the rules below → **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /families/{code} {
         // Only a client that knows the exact 6-char code can read or write
         // that family, and nobody can list all families.
         allow get, write: if request.auth != null
                           && code.matches('^[A-Z2-9]{6}$');
         allow list: if false;
       }
     }
   }
   ```

   > These rules matter: `allow read` (instead of `get`) would let anyone with
   > your project ID download *every* family's data, code or not.

5. Project overview → **⚙ Project settings → Your apps → Web app (`</>`)** →
   register it → copy the `firebaseConfig = { ... }` object.
6. Paste it into [shared/config.js](shared/config.js) (replace the `null`).

Now the Parent app shows a **Create our family** screen → it generates a 6-letter
family code → your kid types that code into their app once, and the two phones are
linked live.

> The family code is the only "password" — anyone who has it (and your app URL)
> can see and edit your family's coins. Fine for a family app; don't post the
> code publicly.

### Putting it on the phones

Phones need the app served over **HTTPS**. Easiest: Firebase Hosting (same
project, free):

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # public directory: .  →  single-page app: No
firebase deploy
```

You'll get a URL like `https://trawley-coin.web.app`. Then:

- **Android / Chrome:** open `…/parent/` on your phone → menu ⋮ → **Add to Home
  screen / Install app**. Kid opens `…/kid/` and does the same.
- **iPhone / Safari:** open the URL → Share □↑ → **Add to Home Screen**.

Each installs as its own app with its own icon (indigo = parent, gold = kid).

## Features

- Preset chores with set Trawley Coin values — parent can add new ones with
  different names, edit values, or delete them (kid app updates live).
- Kid taps a chore → parent gets it under **Requests** with the suggested value;
  parent picks the final amount when approving (or denies it kindly).
- "Did something else?" free-text messages from the kid.
- Coin history ledger + manual add/spend (pocket-money spends, bonuses).
- Parent PIN so the kid can't open the management app (stored hashed, and
  re-locks whenever the app is closed or reopened).
- Works offline after first visit: the last-known balance, chores and history
  still show, and Firestore's local cache replays writes made offline once the
  phone reconnects. If a save can't go through you get a toast, never a silent loss.
- Installs to the home screen like a native app.

## Project layout

```
index.html            landing page (pick Parent / Kid)
parent/               parent PWA (manifest, UI, logic)
kid/                  kid PWA (manifest, UI, logic)
shared/store.js       data model + live sync (localStorage or Firestore)
shared/config.js      paste your Firebase config here
shared/style.css      shared styles (light + dark mode)
sw.js                 service worker (offline shell cache)
icons/                app icons
```

No build step, no dependencies — plain HTML/JS/CSS. Host it at any HTTPS root.
