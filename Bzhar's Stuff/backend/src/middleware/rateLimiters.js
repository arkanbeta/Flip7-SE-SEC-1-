import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/AppError.js';

function createLimiter({ windowMs, limit, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7', // RateLimit-* headers tell well-behaved clients when to retry
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    // Use our normal error format.
    handler: (req, res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait a few minutes and try again.')),
  });
}

// Limits are per client IP, kept in memory (fine for one backend instance;
// move to Redis if the backend is ever scaled out).
export function createRateLimiters(config) {
  const { windowMs, authMax, lookupMax } = config.rateLimit;
  return {
    // Sign-in, OAuth callback, account creation: slows credential/abuse attempts.
    auth: createLimiter({ windowMs, limit: authMax }),
    // Cheap lookups (nickname availability): more generous, still capped.
    lookup: createLimiter({ windowMs, limit: lookupMax }),
    // Game moves: counted per signed-in PLAYER (not per IP, a whole family may share one),
    // in short windows. Real play is about one move per few seconds.
    action: createLimiter({ windowMs: 10_000, limit: 30, keyGenerator: (req) => `user:${req.session?.userId ?? 'anonymous'}` }),
  };
}
