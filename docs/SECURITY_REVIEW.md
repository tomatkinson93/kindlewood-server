# Security and exploit review (2026-11-12)

Status: **S1–S4 fixed (2026-11-13)**; S5–S8 open. See "What was done" at the end.

## Scope and limits

A read of the server's sign-in, admin gates and resource-granting routes, plus a look at how the web client displays player-chosen text. I confirmed S1 and S4 against a local server; the rest is from reading code.

Not covered: a line-by-line read of all 42 route files (the Market, at about 2,000 lines, was only sampled), the tavern card-game rooms, and any testing against the live site.

## Findings

| # | Severity | Finding |
|---|---|---|
| S1 | **High** | A player can put HTML in their username or town name, and the game runs it in other players' browsers |
| S2 | **High** | Requests from other websites can act as a signed-in player (and as an admin) |
| S3 | Medium | No limit on sign-in or registration attempts |
| S4 | Medium | Registration accepts any type and length for its fields |
| S5 | Medium | Server errors are sent to the browser word for word |
| S6 | Low | Sign-in tokens travel in web addresses for live streams |
| S7 | Low | Tokens last 7 days and cannot be revoked; there is no password change or reset |
| S8 | Low | No security headers on the API |

### S1 — Script injection through names (High)

- **What:** `POST /api/auth/register` stores `username` exactly as sent, and the town is named `<username>'s Camp`. `PATCH /api/game/settlement/rename` only checks that the name has 2 or more characters. The client then puts these into the page as HTML.
- **Confirmed:** a local server accepted the username `<img src=x onerror=alert(1)>`.
- **Where it runs** (`js/main.js`):
  - line 1453: `⛺ ${tile.outpost.owner}'s outpost stands here.`
  - line 2045: the "Ruler" box, `(s.username||'—')`
  - line 2050: `data-username="…"` and `data-name="…"` attributes

  A rough search found 7 such places; there are likely more.
- **Why it matters:** the sign-in token is kept in the browser's `localStorage`, which any script on the page can read. An attacker who gets a player to tap their town or outpost can copy that player's token and act as them for up to 7 days. If the player is an admin, that includes wiping or restoring the world.
- **Fix:**
  1. Validate on the server:
     - usernames `^[A-Za-z0-9_-]{3,20}$`;
     - town names 2–32 characters of letters, digits, spaces, apostrophes and hyphens (the clan-name rule in `routes/clans.js` is the model).
  2. Clean up existing rows once: strip `<`, `>`, `"` and `&` from `users.username` and `settlements.name`.
  3. Escape at every place the client shows a username, town name or owner (`escHtml` exists in `js/profile.js`). Prefer `textContent` for new code.
  4. Add a frontend proof that fails when `username`, `.owner` or a town name is joined into an HTML string without escaping.

### S2 — Cross-site requests (High)

- **What:** sign-in sets a cookie with `SameSite=None` in production, and `middleware/auth.js` accepts that cookie. A page on any other website can therefore send requests that carry a visiting player's cookie.
- **What limits it:** the server only reads JSON bodies, and browsers ask permission before sending JSON across sites, which the CORS list refuses. So only requests that need **no body** are exposed.
- **What is exposed:** for players, routes such as `POST /api/game/upgrade-tier`, outpost upgrade, fortify and road (they spend resources). For admins, `POST /api/game/world/restore`, `reset-fog` and `reveal-all`, and the outpost Dev Tools.
- **How likely:** it depends on the browser still sending third-party cookies; several block them by default now. The comment in `routes/auth.js` says the cookie is often dropped, and the client already sends the token in an `Authorization` header instead.
- **Fix:** stop using the cookie. Remove `res.cookie(...)` from register and login, and stop reading `req.cookies.token` in `middleware/auth.js`, `routes/auth.js /me`, `game_stats.js`, `presence.js`, `rooms.js` and `stream.js`. The client needs no change.

### S3 — No attempt limits (Medium)

- **What:** nothing limits how often one address can call sign-in or register. Passwords can be guessed at speed, and accounts (each with a town on the map) can be created in bulk.
- **Fix:** a rate limiter on `/api/auth/login` (about 10 a minute per address and per email) and `/api/auth/register` (about 5 an hour per address). Set Express's `trust proxy` so Render's proxy doesn't make every player look like one address.

### S4 — Registration input (Medium)

- **Confirmed:** a local server accepted a 3,000-character username, and a username that was a JSON object (`{"a":1}`), which then went into the token.
- Also: the email is not checked to look like one; the password has no upper limit (very long passwords make hashing slow, and bcrypt ignores everything past 72 bytes).
- **Fix:** require strings; apply the username rule from S1; check the email's shape and cap it at 254 characters; cap passwords at 72 bytes.

### S5 — Raw error text (Medium)

- **What:** at least 79 places across 20 route files answer a failure with `error: e.message`. Database errors name tables, columns and constraints.
- **Fix:** log the real error on the server and send a fixed sentence. Keep `e.message` only where the code threw a deliberate, player-facing message (the `MarketError` pattern).

### S6–S8 — Lower priority

- **S6:** live streams (`routes/stream.js`, `rooms.js`, `presence.js`, `game_stats.js`) accept `?token=`, because the browser's stream API cannot send headers. Addresses end up in server logs. Later: issue a short-lived, single-use stream ticket.
- **S7:** add password change and reset when accounts start to matter; consider shorter tokens with refresh.
- **S8:** add `helmet` to the API for standard headers. A content security policy for the site is not practical while it uses inline `onclick` handlers; revisit after the layout rework.

## Checked and found sound

- **Admin gates:** every cheat, world and admin route sampled goes through `requireAuth, requireAdmin`. With `ADMIN_USER_IDS` unset, nobody is an admin.
- **Ownership:** housing, citizen roles, outposts and quests all look up the caller's own settlement before acting.
- **Database queries:** values are passed as parameters. Where a column name is built into a query, it comes from a fixed list (resources, recipes) or is checked first.
- **Combat:** the server replays the saved action log and ignores the client's claimed result. Battles with no quest are admin-only.
- **Fishing, clan donations, village tribute:** decided or validated on the server; amounts are floored and checked.
- **Passwords:** hashed with bcrypt.
- **Dependencies:** `npm audit` reports no known vulnerabilities.
- **Sign-in secret:** fixed in Phase 0 (`lib/jwt_secret.js`).

## One related bug (not security)

**Fixed 2026-11-13 (Phase 1 step 1).** `deaths.js` marked a citizen deceased but left their `house_id`. The housing route counts every citizen in a house, so **the dead still take up a place**. Phase 1's bed count must use living citizens only, and death should clear `house_id`.

## What was done (2026-11-13)

- **S1:**
  - `lib/names.js` holds the rules, used by register and rename. Ruler names are 3–20 letters, digits, `_` or `-`, **with single spaces between words**. The review said no spaces, but the sign-up form's own example is "Aldric Thornpaw", and spaces carry no risk.
  - Town names are 2–32 letters (any alphabet), digits, spaces, apostrophes, `_` or `-`. House names have `< > " & \`` stripped.
  - `0NN_name_cleanup.sql` strips those characters from existing usernames and town names. A clash becomes `player<id>`.
  - Client: `escHtml` at every place found (`main.js` tile panel, tier card, Ruler box, View Profile attributes). The event feed and event toasts are escaped or plain text. `verify/names_proofs.js` fails on any unescaped username, owner or town name in an HTML string.
- **S2:** no cookie is set or read. Logout still clears an old one.
- **S3:** `lib/rate_limit.js` (in memory, one instance): login 10 a minute per address and per email, register 5 an hour per address. Loopback is exempt outside production so local test runs work. `trust proxy` is 1 (`TRUST_PROXY_HOPS` overrides it). **Check after deploy** that `req.ip` is the player's address, not Render's, or every player shares one limit.
- **S4:** strings only; email shape and 254-character cap; passwords 8–72 bytes. Login refuses non-strings.
- Tests: `scripts/security_test.js`.

## Suggested order

1. S1 and S2 together (small, and both lead to account takeover).
2. S4 and S3.
3. S5, a file at a time, as files are touched.
4. S6–S8 after 1.0.
