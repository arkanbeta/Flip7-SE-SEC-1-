# 10 - Setup requirements and compatibility

This page records **exactly what the project needs and what it was built and tested with**, so you can check your own machine against it. If your versions differ from the "tested with" column but satisfy the "minimum" column, it should work; if something breaks, compare with the tested versions first.

## Tools you need installed

| Tool | Minimum | Tested with | Why this minimum |
| --- | --- | --- | --- |
| **Node.js** | 20 | v22.23.4 | Modern ES modules, `node --watch`, and what Vite and Vitest require |
| **npm** | 9 | 10.9.9 | Comes with Node; lock files (`package-lock.json`) were created with this version |
| **MySQL** | **8.0.16** | 8.0.46-0ubuntu0.24.04.4 | Earlier versions do not enforce `CHECK` constraints (room capacity 3-7) and lack the `utf8mb4_0900_ai_ci` collation used by the schema |
| **Git** | any recent | - | Version control (see the Git guide, added in Phase 8) |

**Not supported:** MariaDB (different collations and `CHECK` behaviour; the backend refuses to start on it), MySQL 5.7, Node 18 or older.

You also need a **Google account** to create the OAuth credentials (see below), and any modern browser (current Chrome, Edge, Firefox or Safari). The interface uses CSS 3D transforms and CSS `color-mix()`, which every current browser supports. *Browser compatibility has not been tested yet*; that is part of Phase 8.

## Exact package versions this project was built and tested with

Installed from the committed `package-lock.json` files. Use `npm ci` (instead of `npm install`) to get exactly these versions.

### Backend (`backend/`)

| Package | Version | Kind |
| --- | --- | --- |
| `cors` | 2.8.6 | runtime |
| `dotenv` | 18.0.9 | runtime |
| `express` | 5.3.0 | runtime |
| `express-mysql-session` | 3.0.3 | runtime |
| `express-rate-limit` | 8.7.3 | runtime |
| `express-session` | 1.19.0 | runtime |
| `google-auth-library` | 11.3.3 | runtime |
| `helmet` | 8.3.0 | runtime |
| `mysql2` | 3.24.6 | runtime |
| `socket.io` | 4.8.4 | runtime |
| `socket.io-client` | 4.8.4 | development (build / test) |
| `supertest` | 7.3.2 | development (build / test) |
| `vitest` | 5.1.0 | development (build / test) |

### Frontend (`frontend/`)

| Package | Version | Kind |
| --- | --- | --- |
| `@fontsource-variable/fredoka` | 5.3.0 | runtime |
| `@fontsource-variable/nunito` | 5.3.0 | runtime |
| `motion` | 14.12.0 | runtime |
| `react` | 19.3.1 | runtime |
| `react-dom` | 19.3.1 | runtime |
| `react-router-dom` | 7.18.5 | runtime |
| `socket.io-client` | 4.8.4 | runtime |
| `@testing-library/react` | 16.3.3 | development (build / test) |
| `@testing-library/user-event` | 14.6.8 | development (build / test) |
| `@vitejs/plugin-react` | 6.2.1 | development (build / test) |
| `jsdom` | 31.0.0 | development (build / test) |
| `vite` | 8.3.6 | development (build / test) |
| `vitest` | 5.1.0 | development (build / test) |

Notes:

- `express` is **version 5**. Its main difference from version 4 is that errors thrown inside `async` route handlers reach the error middleware automatically; the code relies on that.
- `backend/package.json` contains an `overrides` entry that forces `express-mysql-session` to use the project's own (patched) `mysql2`. Without it, the session store would pull in an older `mysql2` with known security advisories. Do not remove it. `npm audit` reports 0 vulnerabilities in both apps with it.
- `motion` (Motion for React) and the two `@fontsource-variable` font packages joined in Phase 3. `socket.io` and `socket.io-client` join in Phase 5 and are not listed because they are not installed yet.
- The fonts are bundled, so the app makes no requests to Google Fonts.

## Environment variables

Every variable is documented in `backend/.env.example` and `frontend/.env.example`. The backend refuses to start, naming the variable, if a required one is missing or malformed. Notable rules enforced at startup:

- `SESSION_SECRET` must be at least 32 characters and must not be the placeholder from `.env.example`.
- In production (`NODE_ENV=production`), `CLIENT_ORIGIN` and `GOOGLE_REDIRECT_URI` must be `https://` URLs.

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Setting up Google sign-in

You need your own Google OAuth client. Google changes the console's menus from time to time; the names below are the current ones, but look for the equivalent if they differ.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and **create a project** (any name, e.g. "Flip 7 Online").
2. Open **APIs & Services > OAuth consent screen** (also shown as "Google Auth Platform") and configure it: app name, your support email, audience **External**.
3. Keep the app in **Testing** mode while developing and add your own Google accounts under **Test users**. In Testing mode, *only listed test users can sign in*. This is the most common reason for an "access blocked" error.
4. The app only requests the `openid` and `email` scopes. These are non-sensitive, so no Google verification review is needed to publish later.
5. Open **APIs & Services > Credentials > Create credentials > OAuth client ID**, type **Web application**.
6. Under **Authorized redirect URIs** add exactly:
   - development: `http://localhost:5173/api/auth/google/callback`
   - production (later): `https://YOUR-DOMAIN/api/auth/google/callback`
7. Copy the **client ID** and **client secret** into `backend/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and set `GOOGLE_REDIRECT_URI` to the same redirect URI you registered. **It must match character for character** (scheme, host, port, path), or Google shows a `redirect_uri_mismatch` error.

The client secret lives only in `backend/.env`. The frontend never receives it.

## What has and has not been verified

Verified in the build environment (Linux, versions above):

- The supplied schema loads on MySQL 8.0.46-0ubuntu0.24.04.4; all backend tests pass against that real database.
- The real backend starts, generates a correct Google authorization URL (right client ID, redirect URI, scopes, random `state` and `nonce`), and sets an `HttpOnly`, `SameSite=Lax` session cookie.
- The complete login, registration, logout, CSRF, rate-limit and session-persistence logic, over real HTTP and a real database, with **Google replaced by a test double**.
- The frontend builds, and its routing, forms and API client pass tests in a simulated browser.

**Not verified yet** (be aware of these when you first run it):

- **A real sign-in with a real Google account.** It needs your Google credentials and a network connection to Google, which the build environment did not have. The code that talks to Google is small and isolated in `backend/src/services/googleOAuthService.js`; its rules (audience check, nonce check, refusing unverified emails) are tested against a mocked Google library. Expect to fix configuration (redirect URI, test users), not logic, if the first attempt fails.
- **Visual appearance in real browsers**, and the card-flip animation. Please look at the login page yourself.
- **Running behind an HTTPS reverse proxy in production** (secure cookies, `TRUST_PROXY`).
