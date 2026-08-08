# In Stock — setup guide

This is a standalone version of the app, built to run on Firebase instead of inside Claude.
It's also installable as a PWA (add-to-home-screen, works offline) and has a Capacitor
scaffold ready for wrapping into real iOS/Android app-store builds later. Follow these
steps in order the next time you're at your computer.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a
   project (e.g. `in-stock`), under the same Firebase/Google account you used for Dinner Bell.
2. **Authentication** → Sign-in method → enable **Google**.
3. **Firestore Database** → Create database → start in production mode → choose a region.
4. **Project settings** (gear icon) → **General** → under "Your apps," click the web icon
   (`</>`) to register a web app. It'll show you a config object with values like `apiKey`,
   `authDomain`, etc. — you'll need these in step 3 below.

## 2. Set Firestore security rules

Production mode starts locked down — nothing can read or write until you set rules. In the
Firebase console: **Firestore Database** → **Rules**, replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/data/{document} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

This means each signed-in user can only ever read or write their own data. Click **Publish**.

## 3. Local setup

```
npm install
cp .env.example .env
```

Open `.env` and fill in the values from step 1's config object. Then:

```
npm run dev
```

Open the URL it gives you (usually `http://localhost:5173`). You should see the sign-in
screen. `localhost` is authorized for Google sign-in by default, so this should work without
any extra configuration.

## 4. Push to GitHub

This repo (`fattymatty007/in-stock`) already exists. The code is currently on the branch
`claude/in-stock-mobile-setup` — open a pull request into `main` (or push directly to `main`)
whenever you're ready.

`.env` is gitignored, so your real keys never get committed — only `.env.example` (the blank
template) does.

## 5. Deploy to Firebase Hosting

```
npm install -g firebase-tools
firebase login
firebase init hosting
```

When prompted: select your existing project, set the public directory to `dist`, and answer
**yes** to "configure as a single-page app." Then:

```
npm run build
firebase deploy
```

You'll get a live URL (`your-project.web.app`). Open it and sign in — this is the real test,
since this is on real hosting with real storage.

**One extra step for sign-in to work here too:** Firebase console → Authentication →
Settings → Authorized domains → add the `your-project.web.app` / `.firebaseapp.com` domains
if they're not already listed (they usually are by default).

### Optional: auto-deploy on push (like Dinner Bell)

Run `firebase init hosting:github` from this project locally — it walks you through
authorizing a GitHub Action, generates a service-account secret in your repo, and writes a
`.github/workflows/*.yml` file that builds and deploys to Firebase Hosting on every push to
`main`. This can't be scripted from here since it needs an interactive Firebase login and
GitHub App authorization.

## 6. Custom domain (Namecheap) — whenever you're ready

1. Firebase console → **Hosting** → **Add custom domain** → enter your domain, e.g.
   `instock.mattsapps.xyz` (matches the `dinner-bell.mattsapps.xyz` pattern).
2. Firebase gives you DNS records to add (a TXT record to verify ownership, then A records).
3. In Namecheap: **Domain List** → **Manage** → **Advanced DNS** → add those exact records.
4. DNS changes can take a few hours to propagate. Once they do, add the custom domain to
   **Authorized domains** in Authentication settings too, same as step 5.

## 7. Installing as a mobile app now (PWA)

No app store needed for this part — once it's deployed (or even on `localhost`):

- **Android (Chrome)**: open the site → menu → **Add to Home screen** / an install icon
  appears in the address bar.
- **iOS (Safari)**: open the site → Share button → **Add to Home Screen**.

It launches full-screen, has its own icon, and works offline for anything already loaded
(`vite-plugin-pwa` precaches the app shell). Replace the placeholder icons in `public/`
(`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `box.svg`)
with real artwork whenever you have a logo — same filenames, same sizes.

## 8. Getting into the App Store / Play Store later

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
