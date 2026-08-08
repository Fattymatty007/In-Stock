# In Stock — setup guide

This is a standalone version of the app, built to run on Firebase instead of inside Claude.
It's also installable as a PWA (add-to-home-screen, works offline) and has a Capacitor
scaffold ready for wrapping into real iOS/Android app-store builds later.

Firebase project `in-stock-bbc23` already exists with Google sign-in and Firestore enabled,
and its web config is committed in `src/firebase.js` (the `apiKey` there isn't a secret — see
the comment in that file). What's left is deploying it and, optionally, a custom domain.

## 1. Deploy — automatic (recommended)

`.github/workflows/deploy.yml` builds and deploys to Firebase Hosting on every push to `main`.
It needs one secret in this GitHub repo:

1. Create a service account for Firebase Hosting:
   [console.cloud.google.com/iam-admin/serviceaccounts/create?project=in-stock-bbc23](https://console.cloud.google.com/iam-admin/serviceaccounts/create?project=in-stock-bbc23)
   - Name it anything (e.g. `github-deploy`) → **Create and continue**
   - Under **Grant this service account access to project**, add the role
     **Firebase Hosting Admin** → **Continue** → **Done**
2. Open that service account in the list → **Keys** tab → **Add key** → **Create new key** →
   **JSON** → it downloads a `.json` file.
3. In GitHub: this repo → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: paste the entire contents of the downloaded JSON file
4. Merge the `claude/in-stock-mobile-setup` branch into `main` (open a PR, or push directly).
   That push triggers the workflow — check the **Actions** tab in GitHub to watch it build and
   deploy. When it finishes, the app is live at `https://in-stock-bbc23.web.app`.

**One extra step for sign-in to work there too:** Firebase console → Authentication →
Settings → Authorized domains — `in-stock-bbc23.web.app` and `.firebaseapp.com` are usually
listed by default, but double check.

## 2. Deploy — manual (alternative)

If you'd rather deploy from your own computer instead of GitHub Actions:

```
npm install
npm install -g firebase-tools
firebase login
npm run build
firebase deploy
```

`firebase login` opens a browser window to sign into the same Google account as the Firebase
project. This only works from a machine that can open a browser locally — it can't be done
from this remote session (its network policy blocks Firebase's login service).

## 3. Custom domain (Namecheap) — whenever you're ready

1. Firebase console → **Hosting** → **Add custom domain** → enter your domain, e.g.
   `instock.mattsapps.xyz` (matches the `dinner-bell.mattsapps.xyz` pattern).
2. Firebase gives you DNS records to add (a TXT record to verify ownership, then A records).
3. In Namecheap: **Domain List** → **Manage** → **Advanced DNS** → add those exact records.
4. DNS changes can take a few hours to propagate. Once they do, add the custom domain to
   **Authorized domains** in Authentication settings too, same as step 1.

## 4. Installing as a mobile app now (PWA)

No app store needed for this part — once it's deployed:

- **Android (Chrome)**: open the site → menu → **Add to Home screen** / an install icon
  appears in the address bar.
- **iOS (Safari)**: open the site → Share button → **Add to Home Screen**.

It launches full-screen, has its own icon, and works offline for anything already loaded
(`vite-plugin-pwa` precaches the app shell). Replace the placeholder icons in `public/`
(`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `box.svg`)
with real artwork whenever you have a logo — same filenames, same sizes.

## 5. Getting into the App Store / Play Store later

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
