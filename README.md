# Morning Stall

Daily sheet for the stall: oats and sandwiches made/sold, cost, profit, and a dashboard.
Everyone who signs in (John, Dhivagar) works on **one shared sheet** — a change made on one
phone shows up on every other login within about 15 seconds.

## How it works

| Part | File |
|---|---|
| The page | `index.html` |
| Login + shared data (Netlify Function) | `netlify/functions/stall.mjs` |
| Where the numbers are kept | Netlify Blobs, store `stall`, key `data` (plus a daily copy `backup-YYYY-MM-DD`) |
| Netlify settings | `netlify.toml`, `package.json` |

Passwords are checked on the server, never in the page.

## Deploy (Netlify)

1. Push this folder to GitHub (`sdhivagar21/Morningstall`).
2. In Netlify: **Add new project → Import an existing project → GitHub → Morningstall**.
   Leave build command empty; publish directory `.` (already set in `netlify.toml`).
3. Every `git push` to `main` redeploys the site.

## Change the passwords

In Netlify: **Project configuration → Environment variables**, add:

- `PASSWORD_JOHN`
- `PASSWORD_DHIVAGAR`

Then redeploy. Until these are set, the original passwords still work. Changing a password signs everyone out.

## Notes

- **Leave:** tap **Leave** under a date when the stall was closed because nobody was available. That day stops counting as "not filled" and is left out of profit; **Undo leave** reopens it.
- Opening `index.html` straight from the computer won't load numbers — the data lives on the server, so use the site's web address.
- Numbers saved in a browser by the old version are added to the shared sheet automatically the first time that browser signs in (only days the shared sheet doesn't already have).
- Adding a new user or item: update `USERS` / `ITEMS` in `netlify/functions/stall.mjs` and `P` in `index.html`.
