# Storage modes and the backup format

## Two modes (chosen on first run, switchable in "שמירת נתונים וגיבוי")

| | Browser mode | File mode |
|---|---|---|
| Where the profile lives | `localStorage` key `portfolio.profile` (same envelope as a backup file) | Only in the user's file |
| Saving | Automatic, debounced (600 ms) | Manual "Save to file": overwrites the remembered file (File System Access API) or downloads |
| On every visit | Loads automatically | Asks for the file (picker, drag and drop, or the remembered file after a permission prompt) |
| Stored in the browser | profile, mode, backup bookkeeping | **only** the mode and theme preferences, plus (optionally) a pointer to the file in IndexedDB. Never profile data |
| Reminders | Backup nudge after 14 days (`config/rules.json` -> `backup`), snoozable | "Unsaved changes" status and a leave-page warning |

Browser mode also requests persistent storage (`navigator.storage.persist()`) after the first save, and warns that clearing
site data deletes the profile and that Safari may evict storage of sites unused for about a week. Switching modes is explicit:
browser -> file offers "save file and switch" (and then removes the browser copy); file -> browser stores the in-memory profile.
"Erase everything the app stored" removes all keys and the remembered file pointer.

Browser keys: `portfolio.mode`, `portfolio.profile`, `portfolio.lastBackupAt`, `portfolio.firstDataAt`, `portfolio.nudgeSnoozedAt`,
`portfolio.theme`. IndexedDB database `portfolio-file-handle` holds at most one file handle.

Browser support: the File System Access API (open/overwrite/remember) needs Chromium. Elsewhere the app uses the file input,
drag and drop and downloads; everything else is identical.

## Backup format

```json
{ "app": "portfolio-pilot", "version": 3, "exportedAt": "2026-10-23T09:00:00.000Z", "profile": { ... } }
```

`app` is unchanged from the prototype so its v2 backups import here. Import is strict: size cap (512 KB), JSON, envelope and
version checks (newer versions are refused with a clear message, v1 is unsupported), then `MIGRATIONS` and finally
`sanitizeProfile`, which rebuilds the profile field by field (unknown fields dropped, strings length-capped, numbers range-checked,
lists capped, enums coerced). User text is stored as inert text and escaped at render time.

| Version | Change |
|---|---|
| 2 | Prototype format |
| 3 | Adds `settings` (benchmark base date, example flag), `watchlist`, `withdrawal` |

To add a version: bump `CURRENT_VERSION`, add `MIGRATIONS[<old>]` in `src/profile/backup.ts`, extend `sanitizeProfile`, and add a
case to `tests/unit/backup.test.ts`. Migrations must not throw and must work on untrusted data.
