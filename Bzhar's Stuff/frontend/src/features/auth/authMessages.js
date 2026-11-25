// Friendly text for the error codes the backend puts in /login?error=CODE.
const SIGN_IN_ERRORS = {
  OAUTH_ACCESS_DENIED: 'Google sign-in was cancelled. You can try again whenever you like.',
  OAUTH_STATE_INVALID: 'That sign-in attempt expired. Please try again.',
  GOOGLE_AUTH_FAILED: "We couldn't complete sign-in with Google. Please try again.",
  GOOGLE_EMAIL_UNVERIFIED: "Your Google account's email address is not verified, so it can't be used here.",
  EMAIL_IN_USE: 'This email address already belongs to another Flip 7 account.',
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
};

// Unknown or missing codes fall back to the generic message (the raw code is never shown).
export function signInErrorMessage(code) {
  if (!code) return null;
  return SIGN_IN_ERRORS[code] ?? SIGN_IN_ERRORS.GOOGLE_AUTH_FAILED;
}

// Same rule as the backend (backend/src/validators/authValidators.js). The backend is the
// one that really enforces it; this only gives instant feedback while typing.
export const NICKNAME_RULE = 'Use 3-20 letters, numbers, underscores or hyphens (no spaces).';
export const isValidNickname = (value) => /^[\p{L}\p{N}_-]{3,20}$/u.test(value);
