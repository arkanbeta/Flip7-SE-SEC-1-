import { AppError } from '../utils/AppError.js';

// Runs when no route matched the request.
export function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Route not found.'));
}

// The ONE place where errors become HTTP responses. Every error response has
// the same shape:  { "error": { "code": "...", "message": "..." } }
//
// Unexpected errors (bugs, database failures) are logged in full on the server,
// but the client only sees a generic message so internals never leak.
// Express recognizes error handlers by their 4 parameters, so keep `next`.
export function createErrorHandler({ logger = console } = {}) {
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) {
      return next(err);
    }

    if (err instanceof AppError) {
      const body = { code: err.code, message: err.message };
      if (err.details !== undefined) body.details = err.details;
      return res.status(err.statusCode).json({ error: body });
    }

    // Errors raised by express.json() for bad request bodies.
    if (err.type === 'entity.parse.failed') {
      return res
        .status(400)
        .json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
    }
    if (err.type === 'entity.too.large') {
      return res
        .status(413)
        .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
    }

    logger.error('Unhandled error:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' },
    });
  };
}
