// An error we THROW ON PURPOSE for an expected problem (bad input, not logged in,
// room full...). The central error handler turns it into a clean JSON response.
//
//   throw new AppError(404, 'ROOM_NOT_FOUND', 'That room does not exist.');
//
// `code` is a stable machine-readable string the frontend can switch on;
// `message` is safe to show to the user.
export class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
