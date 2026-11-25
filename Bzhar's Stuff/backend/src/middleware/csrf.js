import crypto from 'node:crypto';
import { AppError } from '../utils/AppError.js';

// CSRF protection ("synchronizer token" pattern).
//
// The attack: a malicious site makes your browser send a request to our API and
// the browser helpfully attaches your login cookie. Defences, layered:
//   1. SameSite=Lax cookies are not sent on cross-site POSTs.
//   2. Every state-changing request (POST/PUT/PATCH/DELETE) must carry a secret token in
//      the X-CSRF-Token header. The token lives in the server-side session and the
//      frontend learns it from GET /api/auth/me. A malicious site cannot read it
//      (CORS blocks that) and so cannot put it in a header.
//   3. If the browser sends an Origin header, it must be our own frontend.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Constant-time comparison so response timing cannot leak the token.
export function safeEqual(a, b) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
}

export function createCsrfProtection({ allowedOrigin }) {
  return function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('origin');
    if (origin && origin !== allowedOrigin) {
      return next(new AppError(403, 'CSRF_INVALID', 'Request origin is not allowed.'));
    }

    const expected = req.session?.csrfToken;
    const provided = req.get('x-csrf-token');
    if (typeof expected === 'string' && typeof provided === 'string' && safeEqual(expected, provided)) {
      return next();
    }
    return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token.'));
  };
}
