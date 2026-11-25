import { AppError } from '../utils/AppError.js';

// Put this in front of any route that needs a logged-in user. The user id comes
// ONLY from the server-side session - never from the request body, query or headers.
export function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) {
    return next(new AppError(401, 'AUTH_REQUIRED', 'You need to sign in to do that.'));
  }
  req.userId = userId;
  return next();
}
