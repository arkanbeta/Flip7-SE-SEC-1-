# 12 - Security and quality review (Phase 8)

A review of the finished application against the specification. "Verified" means an automatic test or a direct check proves it; "By design" means it is a deliberate rule; "Not verified" is an honest gap.

## Security checklist

| Area | Status | How |
| --- | --- | --- |
| SQL injection | Verified | Every query is parameterized (`?` placeholders, mysql2); no string-built SQL. Inputs are also validated first |
| Authentication | Verified | Google sign-in only; the session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production; sessions live in MySQL and expire when idle |
| Authorization | Verified | `security.integration.test.js` calls **every** endpoint without a login (refused) and checks that the user id always comes from the session, never from the request. Room actions check membership; host-only actions check `creatorId` |
| CSRF | Verified | Every POST needs the `X-CSRF-Token` header and an allowed `Origin`; the sweep test proves it for all nine write endpoints |
| CORS | Verified | Only `CLIENT_ORIGIN` receives CORS headers |
| Sockets | Verified | Same session as HTTP, Origin checked, anonymous sockets refused, clients cannot send messages (server push only), at most 5 sockets per user, 1 KB buffer |
| Server authority | By design | The browser never decides a move: the engine checks whose turn it is, the question id (blocks double clicks / stale moves), and the legal targets. Time limits are server clocks |
| Hidden information | Verified | The draw-pile order is never sent; e-mail and Google id never appear in room or profile responses (test) |
| Rate limiting | Verified | Sign-in, join and create per IP; game moves, ready, rematch, leave, start per player (30 per 10 s). A test hits the limit |
| Brute-forcing room codes | By design | 6-character codes from an unambiguous alphabet, unique in the database, join attempts rate limited per IP. Anyone with a code can enter (that is the feature); a full room refuses everyone |
| Input validation | Verified | Whitelisted types, integer ranges, body size limit 10 KB, JSON errors never include stack traces (test) |
| Headers | Verified | Helmet (CSP, no-sniff, frame protection, HSTS in production), no `X-Powered-By` |
| Secrets | By design | Only in `backend/.env`, ignored by Git; startup refuses placeholder or short session secrets in production. See doc 09 for what to do if one leaks |
| Dependencies | Verified | `npm audit --omit=dev` reports 0 vulnerabilities in both apps |
| Duplicate match saving | Verified | One report per match (in-memory flag) plus one database transaction; a test finishes a match and fetches it repeatedly and counts the rows |
| Abuse by leaving | By design | A player who walks out of a running match gets 0 points (with a confirmation); spectators leave freely |

## Known limits (not bugs, but you should know)

1. **One backend instance.** Rooms, games and rate limits live in memory; sessions live in MySQL. Running two instances needs Redis (the managers are behind small interfaces for this) and a database-level match token (doc 01, decision 2).
2. **A restart ends every running match** (nothing is saved for it; the room rows are cleared at startup).
3. **Any member can see the room's player list** (nicknames, avatars) and, with the code, join. There are no kicks or bans yet.
4. **A disconnected player is removed after the grace period** (default 30 s) and gets 0 points in a running match.
5. **Not verified:** a real Google sign-in with your own OAuth client; a real HTTPS deployment behind a proxy (`TRUST_PROXY`, secure cookies); Safari / Firefox / Edge behaviour; many simultaneous rooms.

## Deployment checklist

1. `NODE_ENV=production`; `CLIENT_ORIGIN` and `GOOGLE_REDIRECT_URI` as `https://` URLs; the redirect URI also added in the Google console.
2. A reverse proxy (nginx, Caddy, ...) terminating HTTPS in front of both the built frontend (`frontend/dist`) and the backend; forward `/api` and `/socket.io` (with WebSocket upgrade) to the backend; set `TRUST_PROXY=1`.
3. Serve the frontend with the same security headers (at least a CSP; Helmet only protects the API's own responses).
4. A strong random `SESSION_SECRET`; a dedicated MySQL user with only the privileges listed in the README.
5. Back up MySQL (matches and accounts are the only permanent data).

## Quality findings fixed in Phase 8

| Finding | Fix |
| --- | --- |
| Busted hands (the same number twice) used duplicate React keys, which can drop a card from the screen | Keys now include the position |
| Results rows overlapped on phone widths | Rows wrap; names break instead of overlapping the points |
| An empty bordered box appeared when the activity feed had nothing to say | The feed is not drawn when empty |
| Five text colours failed the 4.5:1 contrast rule; form outlines were too faint (1.2:1) | Darker "text-safe" tokens and a stronger field outline (doc 08) |
| `leave`, `start` and `start-response` had no rate limit | They share the per-player limiter |
