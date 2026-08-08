# In Stock — setup guide

This is a standalone version of the app, built to run on Firebase instead of inside Claude.
It's also installable as a PWA (add-to-home-screen, works offline) and has a Capacitor
scaffold ready for wrapping into real iOS/Android app-store builds later.

Firebase project `in-stock-bbc23` already exists with Google sign-in and Firestore enabled,
and its web config is committed in `src/firebase.js` (the `apiKey` there isn't a secret — see
the comment in that file). Firebase is only used client-side here (Auth + Firestore) — hosting
is plain GitHub Pages, same as Dinner Bell, so no service account or extra secrets are needed.

## 1. Enable GitHub Pages (one-time, if not already on)

Repo → **Settings** → **Pages** → under **Build and deployment**, set **Source** to
**GitHub Actions**. (Skip this if it's already set that way, e.g. because you copied the
setting from Dinner Bell.)

## 2. Get the code onto `main`

Everything is currently on the `claude/in-stock-mobile-setup` branch. Merge it into `main`
(via a PR, or a direct push) — that push is what triggers `.github/workflows/deploy.yml`,
which builds and publishes to GitHub Pages automatically. Check the repo's **Actions** tab to
watch it run. When it finishes, the app is live at `https://fattymatty007.github.io/in-stock/`
(or a custom domain, see below).

## 3. Authorize the domain in Firebase

Google sign-in only works from domains Firebase knows about. Firebase console →
**Authentication** → **Settings** → **Authorized domains** → **Add domain** → add whichever
domain the app actually ends up served from (the `github.io` URL above, and/or your custom
domain once that's set up). `localhost` is already listed for local development.

## 4. Custom domain: in-stock.mattsapps.xyz

`public/CNAME` already points GitHub Pages at `in-stock.mattsapps.xyz`. Two things left,
both outside this repo:

1. In Namecheap (or wherever `mattsapps.xyz` is registered): **Domain List** → **Manage** →
   **Advanced DNS** → add a `CNAME` record — host `in-stock`, value `fattymatty007.github.io.`
   (matches how `dinner-bell` is set up there).
2. Repo → **Settings** → **Pages** should show `in-stock.mattsapps.xyz` as the custom domain
   already (picked up from the `CNAME` file) — once DNS propagates, tick **Enforce HTTPS**
   there if it isn't already checked.

DNS changes can take a few hours to propagate. Once `in-stock.mattsapps.xyz` loads the app,
add it to **Authorized domains** in Firebase too (step 3 above) — sign-in won't work on the
new domain until you do.

## 5. Installing as a mobile app now (PWA)

No app store needed for this part — once it's deployed:

- **Android (Chrome)**: open the site → menu → **Add to Home screen** / an install icon
  appears in the address bar.
- **iOS (Safari)**: open the site → Share button → **Add to Home Screen**.

It launches full-screen, has its own icon, and works offline for anything already loaded
(`vite-plugin-pwa` precaches the app shell). Replace the placeholder icons in `public/`
(`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `box.svg`)
with real artwork whenever you have a logo — same filenames, same sizes.

## 6. Local development (optional)

```
npm install
npm run dev
```

Opens at `http://localhost:5173`. `localhost` is authorized for Google sign-in by default.

## 7. Getting into the App Store / Play Store later

The repo already has a Capacitor scaffold (`capacitor.config.json`, `android/`, `ios/`) so
you don't have to restructure anything when you're ready — you just need the platform tools
and developer accounts at that point:

```
npm run build
npx cap sync
```

- **Android**: open `android/` in [Android Studio](https://developer.android.com/studio),
  build a signed release, and upload it through the
  [Google Play Console](https://play.google.com/console) (one-time $25 registration fee).
- **iOS**: open `ios/App/App.xcworkspace` in Xcode (requires a Mac). You'll need CocoaPods
  installed first (`sudo gem install cocoapods && cd ios/App && pod install`), and an active
  [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year) to
  submit to the App Store.

Both native shells load the same `dist/` web build under the hood — any change you make to
the React app just needs `npm run build && npx cap sync` before rebuilding the native app.

## What changed from the Claude-artifact version

- All the `window.storage` retry/timeout code is gone — replaced with Firestore, which
  handles reliability itself. `dataStore.js` has the two functions that do this now.
- Data is scoped per signed-in Google account instead of per Claude session.
- Everything else — Sales, Inventory, Calendar, the sales-day workflow, backup/restore — is
  unchanged.
