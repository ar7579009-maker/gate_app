# GATE Companion (Android)

Offline companion for the GATE Command Center: focus timer, lecture ticks, mock scores.
Built with Capacitor. Data lives in on-device SQLite. Sync to Supabase comes in milestone 3.

## Get the APK (no installs on your PC)
1. Push to GitHub. The workflow in `.github/workflows/android.yml` runs typecheck, tests and builds `app-debug.apk`.
2. Open the run under Actions, download the `gate-companion-debug` artifact, unzip it.
3. Copy `app-debug.apk` to the phone and open it. Allow "install unknown apps" for your file manager when asked.

## Develop
- `npm install`, then `npm run dev` for the browser preview (uses in-memory storage).
- `npm run sync` builds the web bundle and copies it into `android/`.
- Open `android/` in Android Studio and press Run to test on a phone.

## Layout
- `src/store.ts`: storage interface, SQLite schema and the outbox table.
- `src/sqlite-store.ts`: binds the store to the Capacitor SQLite plugin (Android only).
- `src/timer.ts`: focus timer based on the wall clock, so it stays correct in the background.
- `src/main.ts`: Today, Timer and Mocks screens.
- Shared planning logic comes from `@gate-cc/core` (see the gate-core project).

## Cloud sync (milestone 3)
- Same Supabase project and login as the desktop app. Sign in on the Today screen with the emailed code.
- Lectures: the newer change wins (last write wins). Sessions: each is saved once, never edited.
- Changes made offline wait in the outbox and go up at the next sync (on open, on reconnect, or with "Sync now").
- Deleted sessions on the desktop are not pulled. Mocks stay on the phone.
- CI needs two repository secrets: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
