import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '../app/AuthProvider.jsx';
import { routes } from '../app/router.jsx';
import * as api from '../services/api.js';

// Keep the real ApiError / googleSignInUrl, but replace everything that would hit the network.
vi.mock('../services/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getMe: vi.fn(),
  registerAccount: vi.fn(),
  logout: vi.fn(),
  checkNickname: vi.fn(),
  getProfile: vi.fn(),
  getMyMatches: vi.fn(),
  updateProfile: vi.fn(),
}));

const USER = { id: 1, nickname: 'Maya_1', email: 'maya@example.com', avatar: 'fox', totalPoints: 0 };
const anonymous = { user: null, pendingProfile: null, csrfToken: null };
const pending = { user: null, pendingProfile: { email: 'new@example.com' }, csrfToken: 'tok' };
const signedIn = { user: USER, pendingProfile: null, csrfToken: 'tok' };

function renderAt(path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
  return router;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.checkNickname.mockResolvedValue({ available: true });
});

describe('protected and public routes', () => {
  it('sends an anonymous visitor from /lobby to the login page', async () => {
    api.getMe.mockResolvedValue(anonymous);
    const router = renderAt('/lobby');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows the lobby to a signed-in user', async () => {
    api.getMe.mockResolvedValue(signedIn);
    renderAt('/lobby');
    expect(await screen.findByRole('heading', { name: 'Ready to play, Maya_1?' })).toBeTruthy();
  });

  it('sends a signed-in user away from /login to the lobby', async () => {
    api.getMe.mockResolvedValue(signedIn);
    const router = renderAt('/login');
    await screen.findByRole('heading', { name: 'Ready to play, Maya_1?' });
    expect(router.state.location.pathname).toBe('/lobby');
  });

  it('redirects / to the lobby (and so to login for visitors)', async () => {
    api.getMe.mockResolvedValue(anonymous);
    const router = renderAt('/');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows a retry screen when the backend is unreachable, then recovers', async () => {
    api.getMe.mockRejectedValueOnce(new api.ApiError(0, 'NETWORK_ERROR', 'down'));
    renderAt('/lobby');
    expect(await screen.findByText(/reach the server/i)).toBeTruthy();

    api.getMe.mockResolvedValue(signedIn);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Ready to play, Maya_1?' })).toBeTruthy();
  });

  it('logs out and returns to the login page', async () => {
    api.getMe.mockResolvedValue(signedIn);
    api.logout.mockResolvedValue(null);
    const router = renderAt('/profile');
    api.getProfile.mockResolvedValue({ user: USER, stats: { matchesPlayed: 0, totalHits: 0, totalBusts: 0 } });
    api.getMyMatches.mockResolvedValue({ matches: [] });
    await userEvent.click(await screen.findByRole('button', { name: /log out/i }));
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/login');
  });
});

describe('login and create-account pages', () => {
  it('login page links to Google with the login intent', async () => {
    api.getMe.mockResolvedValue(anonymous);
    renderAt('/login');
    const link = await screen.findByRole('link', { name: /continue with google/i });
    expect(link.getAttribute('href')).toBe('/api/auth/google?intent=login');
  });

  it('create-account page links to Google with the register intent', async () => {
    api.getMe.mockResolvedValue(anonymous);
    renderAt('/create-account');
    const link = await screen.findByRole('link', { name: /continue with google/i });
    expect(link.getAttribute('href')).toBe('/api/auth/google?intent=register');
  });

  it('shows a friendly message for a known error code', async () => {
    api.getMe.mockResolvedValue(anonymous);
    renderAt('/login?error=OAUTH_ACCESS_DENIED');
    expect((await screen.findByRole('alert')).textContent).toMatch(/cancelled/i);
  });

  it('shows a generic message (never the raw text) for an unknown code', async () => {
    api.getMe.mockResolvedValue(anonymous);
    renderAt('/login?error=%3Cb%3Ehack%3C%2Fb%3E');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/couldn't complete sign-in/i);
    expect(alert.textContent).not.toContain('hack');
  });

  it('shows no alert when there is no error', async () => {
    api.getMe.mockResolvedValue(anonymous);
    renderAt('/login');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('profile setup (nickname + avatar)', () => {
  const nicknameInput = () => screen.getByLabelText('Nickname');
  const submit = () => screen.getByRole('button', { name: 'Create account' });

  it('needs a pending Google sign-in: visitors are sent to create-account', async () => {
    api.getMe.mockResolvedValue(anonymous);
    const router = renderAt('/create-account/profile');
    await screen.findByRole('heading', { name: 'Create your account' });
    expect(router.state.location.pathname).toBe('/create-account');
  });

  it('shows the Google email and offers 14 avatars', async () => {
    api.getMe.mockResolvedValue(pending);
    renderAt('/create-account/profile');
    expect(await screen.findByText(/new@example\.com/)).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(14);
  });

  it('explains why an unknown Google account on the login page is creating an account', async () => {
    api.getMe.mockResolvedValue(pending);
    renderAt('/create-account/profile?from=login');
    expect(await screen.findByText(/couldn.t find an account/i)).toBeTruthy();
  });

  it('keeps the button disabled until the nickname is valid AND an avatar is picked', async () => {
    api.getMe.mockResolvedValue(pending);
    renderAt('/create-account/profile');
    await screen.findByLabelText('Nickname');
    expect(submit().disabled).toBe(true);

    await userEvent.type(nicknameInput(), 'ab');
    expect(screen.getAllByText(/3-20 letters/i).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('radio', { name: 'Owl' }));
    expect(submit().disabled).toBe(true); // nickname still too short

    await userEvent.type(nicknameInput(), 'cd');
    await waitFor(() => expect(submit().disabled).toBe(false));
  });

  it('rejects spaces and symbols while typing', async () => {
    api.getMe.mockResolvedValue(pending);
    renderAt('/create-account/profile');
    await userEvent.type(await screen.findByLabelText('Nickname'), 'bad name!');
    await userEvent.click(screen.getByRole('radio', { name: 'Fox' }));
    expect(submit().disabled).toBe(true);
    expect(nicknameInput().getAttribute('aria-invalid')).toBe('true');
    expect(api.checkNickname).not.toHaveBeenCalled(); // invalid names are never even sent
  });

  it('reports a taken nickname and blocks submission', async () => {
    api.getMe.mockResolvedValue(pending);
    api.checkNickname.mockResolvedValue({ available: false });
    renderAt('/create-account/profile');
    await userEvent.type(await screen.findByLabelText('Nickname'), 'Taken_1');
    await userEvent.click(screen.getByRole('radio', { name: 'Cat' }));
    expect(await screen.findByText(/already taken/i)).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  it('creates the account with the chosen values and lands in the lobby', async () => {
    api.getMe.mockResolvedValue(pending);
    api.registerAccount.mockResolvedValue({ user: USER, csrfToken: 'tok2' });
    const router = renderAt('/create-account/profile');
    await userEvent.type(await screen.findByLabelText('Nickname'), '  Maya_1 ');
    await userEvent.click(screen.getByRole('radio', { name: 'Fox' }));
    await waitFor(() => expect(submit().disabled).toBe(false));
    await userEvent.click(submit());

    expect(api.registerAccount).toHaveBeenCalledWith({ nickname: 'Maya_1', avatar: 'fox' });
    await screen.findByRole('heading', { name: 'Ready to play, Maya_1?' });
    expect(router.state.location.pathname).toBe('/lobby');
  });

  it('shows the server error when the nickname was taken in the meantime', async () => {
    api.getMe.mockResolvedValue(pending);
    api.registerAccount.mockRejectedValue(new api.ApiError(409, 'NICKNAME_TAKEN', 'taken'));
    renderAt('/create-account/profile');
    await userEvent.type(await screen.findByLabelText('Nickname'), 'Racer_1');
    await userEvent.click(screen.getByRole('radio', { name: 'Pig' }));
    await waitFor(() => expect(submit().disabled).toBe(false));
    await userEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toMatch(/already taken/i);
    expect(submit().disabled).toBe(true);
  });

  it('offers to start over when the sign-in session has expired', async () => {
    api.getMe.mockResolvedValue(pending);
    api.registerAccount.mockRejectedValue(new api.ApiError(403, 'NO_PENDING_REGISTRATION', 'x'));
    renderAt('/create-account/profile');
    await userEvent.type(await screen.findByLabelText('Nickname'), 'Late_1');
    await userEvent.click(screen.getByRole('radio', { name: 'Bear' }));
    await waitFor(() => expect(submit().disabled).toBe(false));
    await userEvent.click(submit());
    expect(await screen.findByRole('link', { name: 'Start again' })).toBeTruthy();
  });
});

describe('api client', () => {
  it('builds the Google sign-in URL for both intents', () => {
    expect(api.googleSignInUrl('login')).toBe('/api/auth/google?intent=login');
    expect(api.googleSignInUrl('register')).toBe('/api/auth/google?intent=register');
  });
});
