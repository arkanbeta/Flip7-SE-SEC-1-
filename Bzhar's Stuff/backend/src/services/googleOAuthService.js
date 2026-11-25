import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../utils/AppError.js';

// The ONLY file that talks to Google. Everything else depends on the two methods
// it returns, so tests replace this whole service with a fake.
//
// Flow (OAuth 2.0 "authorization code", server side):
//   1. getAuthorizationUrl()  -> we send the browser to Google.
//   2. Google sends the browser back to us with ?code=...
//   3. exchangeCode()         -> OUR SERVER swaps the code for tokens, using the client
//      secret (which never reaches the browser), and cryptographically verifies the
//      ID token: signature, audience (our client id), expiry, and our nonce.
export function createGoogleOAuthService({ clientId, clientSecret, redirectUri }) {
  const client = new OAuth2Client({ clientId, clientSecret, redirectUri });

  const fail = (message, cause) => {
    const error = new AppError(502, 'GOOGLE_AUTH_FAILED', 'Google sign-in could not be completed.');
    error.cause = cause ?? new Error(message);
    return error;
  };

  return {
    getAuthorizationUrl({ state, nonce }) {
      const url = new URL(
        client.generateAuthUrl({
          scope: ['openid', 'email'], // identity + email only: nothing else is requested
          state, // anti-CSRF value for the login flow itself
          prompt: 'select_account', // always let the person choose which Google account
          access_type: 'online',
        })
      );
      url.searchParams.set('nonce', nonce); // ties the ID token to this login attempt
      return url.toString();
    },

    async exchangeCode({ code, nonce }) {
      let payload;
      try {
        const { tokens } = await client.getToken(code);
        if (!tokens.id_token) throw new Error('Google returned no ID token');
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
        payload = ticket.getPayload();
      } catch (error) {
        throw fail('Token exchange or verification failed', error);
      }

      if (!payload?.sub || !payload.email) throw fail('ID token has no subject or email');
      if (payload.nonce !== nonce) throw fail('ID token nonce does not match');

      return {
        googleId: payload.sub, // Google's permanent unique id for the account
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified === true,
      };
    },
  };
}
