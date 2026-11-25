import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '../app/AuthProvider.jsx';
import { routes } from '../app/router.jsx';
import * as api from '../services/api.js';
import { MODE_RULES } from '../features/rules/rulesData.js';

vi.mock('../services/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getMe: vi.fn(),
  registerAccount: vi.fn(),
  logout: vi.fn(),
  checkNickname: vi.fn(),
  getProfile: vi.fn(),
  getMyMatches: vi.fn(),
  updateProfile: vi.fn(),
  getCurrentRoom: vi.fn(),
  getRoomModes: vi.fn(),
}));

const USER = { id: 1, nickname: 'Maya_1', email: 'maya@example.com', avatar: 'fox', totalPoints: 42 };
const STATS = { matchesPlayed: 3, totalHits: 1200, totalBusts: 4 };
const MATCH = {
  matchId: 9, gameMode: 'Normal', finishedAt: '2026-11-10T18:30:00.000Z', numberOfRounds: 5,
  finalPoints: 87, rankingPoints: 12, hits: 11, busts: 2,
};

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
  api.getMe.mockResolvedValue({ user: USER, pendingProfile: null, csrfToken: 'tok' });
  api.getProfile.mockResolvedValue({ user: USER, stats: STATS });
  api.getMyMatches.mockResolvedValue({ matches: [MATCH] });
  api.checkNickname.mockResolvedValue({ available: true });
  api.getCurrentRoom.mockResolvedValue({ room: null });
});

describe('lobby', () => {
  it('shows the profile icon, Create Game, Join Game and Rules', async () => {
    renderAt('/lobby');
    expect(await screen.findByRole('link', { name: /your profile/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /create game/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /join game/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /rules/i }).getAttribute('href')).toBe('/rules');
  });

  it('the profile icon opens the profile page', async () => {
    const router = renderAt('/lobby');
    await userEvent.click(await screen.findByRole('link', { name: /your profile/i }));
    await screen.findByRole('heading', { name: 'Your profile' });
    expect(router.state.location.pathname).toBe('/profile');
  });

  it('Rules opens the rules page', async () => {
    const router = renderAt('/lobby');
    await userEvent.click(await screen.findByRole('link', { name: /rules/i }));
    await screen.findByRole('heading', { name: 'Rules' });
    expect(router.state.location.pathname).toBe('/rules');
  });

  it('links to the Discord server invite in a new tab', async () => {
    renderAt('/lobby');
    const link = await screen.findByRole('link', { name: /join discord/i });
    expect(link.getAttribute('href')).toBe('https://discord.gg/QUdVmBP6d');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('Create Game opens a dialog, and Escape closes it', async () => {
    api.getRoomModes.mockResolvedValue({ modes: [{ id: 1, name: 'Normal' }] });
    renderAt('/lobby');
    await userEvent.click(await screen.findByRole('button', { name: /create game/i }));
    await screen.findByRole('dialog', { name: /create a game/i });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  describe('Join Game dialog', () => {
    async function openJoin() {
      renderAt('/lobby');
      await userEvent.click(await screen.findByRole('button', { name: /join game/i }));
      return screen.findByRole('dialog', { name: /join a game/i });
    }

    it('cleans the code to upper-case letters/digits and enables Join only for a valid one', async () => {
      const dialog = await openJoin();
      const input = within(dialog).getByLabelText('Room code');
      const join = within(dialog).getByRole('button', { name: 'Join' });
      expect(join.disabled).toBe(true);
      await userEvent.type(input, 'ab-c');
      expect(input.value).toBe('ABC');
      expect(join.disabled).toBe(true);
      await userEvent.type(input, 'd!9');
      expect(input.value).toBe('ABCD9');
      expect(join.disabled).toBe(false);
    });

    it('never accepts more than 10 characters', async () => {
      const dialog = await openJoin();
      const input = within(dialog).getByLabelText('Room code');
      await userEvent.type(input, 'ABCDEFGHIJKLMNOP');
      expect(input.value).toBe('ABCDEFGHIJ');
    });

    it('keeps keyboard focus inside the dialog (Tab wraps around)', async () => {
      const dialog = await openJoin();
      const focusable = within(dialog).getAllByRole('button');
      focusable[focusable.length - 1].focus();
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });
});

describe('profile page', () => {
  it('shows nickname, email, avatar, ranking points, statistics and match history', async () => {
    renderAt('/profile');
    expect(await screen.findByRole('heading', { name: 'Maya_1' })).toBeTruthy();
    expect(screen.getByText('maya@example.com')).toBeTruthy();
    expect(screen.getByRole('img', { name: /maya_1's avatar/i })).toBeTruthy();

    const stats = await screen.findByRole('region', { name: /statistics/i }, { timeout: 3000 }).catch(() => null);
    const root = stats ?? document.body;
    const statValue = (label) => within(root).getByText(label).closest('div').querySelector('dd').textContent;
    expect(statValue('Ranking points')).toBe('42');
    expect(statValue('Matches played')).toBe('3');
    expect(statValue('Total hits')).toBe((1200).toLocaleString());
    expect(statValue('Total busts')).toBe('4');

    const match = (await screen.findAllByRole('listitem'))[0];
    expect(within(match).getByText('Normal')).toBeTruthy();
    expect(within(match).getByText('87')).toBeTruthy();
    expect(within(match).getByText('+12')).toBeTruthy();
  });

  it('shows a friendly empty state with no matches', async () => {
    api.getMyMatches.mockResolvedValue({ matches: [] });
    renderAt('/profile');
    expect(await screen.findByText(/no matches yet/i)).toBeTruthy();
  });

  it('shows an error with a retry button when statistics fail to load', async () => {
    api.getProfile.mockRejectedValueOnce(new api.ApiError(0, 'NETWORK_ERROR', 'down'));
    renderAt('/profile');
    expect(await screen.findByText(/couldn.t load your statistics/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Matches played')).toBeTruthy();
  });

  describe('editing', () => {
    async function openEditor() {
      renderAt('/profile');
      await userEvent.click(await screen.findByRole('button', { name: /edit profile/i }));
      return screen.findByRole('dialog', { name: /edit profile/i });
    }

    it('starts from the current values with Save disabled, and explains the email is fixed', async () => {
      const dialog = await openEditor();
      expect(within(dialog).getByLabelText('Nickname').value).toBe('Maya_1');
      expect(within(dialog).getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
      expect(within(dialog).getByText(/can.t be changed/i)).toBeTruthy();
      expect(within(dialog).queryByLabelText(/email/i)).toBeNull(); // no editable email field
    });

    it('saves a new nickname, sending only what changed, and updates the app', async () => {
      api.updateProfile.mockResolvedValue({ user: { ...USER, nickname: 'Maya_2' } });
      const dialog = await openEditor();
      const input = within(dialog).getByLabelText('Nickname');
      await userEvent.clear(input);
      await userEvent.type(input, 'Maya_2');
      const save = within(dialog).getByRole('button', { name: 'Save changes' });
      await waitFor(() => expect(save.disabled).toBe(false));
      await userEvent.click(save);
      expect(api.updateProfile).toHaveBeenCalledWith({ nickname: 'Maya_2' });
      expect(await screen.findByRole('heading', { name: 'Maya_2' })).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('saves a new avatar', async () => {
      api.updateProfile.mockResolvedValue({ user: { ...USER, avatar: 'owl' } });
      const dialog = await openEditor();
      await userEvent.click(within(dialog).getByRole('radio', { name: 'Owl' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
      expect(api.updateProfile).toHaveBeenCalledWith({ avatar: 'owl' });
    });

    it('blocks a nickname reported taken', async () => {
      api.checkNickname.mockResolvedValue({ available: false });
      const dialog = await openEditor();
      const input = within(dialog).getByLabelText('Nickname');
      await userEvent.clear(input);
      await userEvent.type(input, 'Taken_1');
      expect(await within(dialog).findByText(/already taken/i)).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
    });

    it('shows the server error if the nickname was taken in the meantime', async () => {
      api.updateProfile.mockRejectedValue(new api.ApiError(409, 'NICKNAME_TAKEN', 'taken'));
      const dialog = await openEditor();
      const input = within(dialog).getByLabelText('Nickname');
      await userEvent.clear(input);
      await userEvent.type(input, 'Racer_1');
      const save = within(dialog).getByRole('button', { name: 'Save changes' });
      await waitFor(() => expect(save.disabled).toBe(false));
      await userEvent.click(save);
      expect((await within(dialog).findByRole('alert')).textContent).toMatch(/already taken/i);
    });

    it('does not offer saving an invalid nickname', async () => {
      const dialog = await openEditor();
      const input = within(dialog).getByLabelText('Nickname');
      await userEvent.clear(input);
      await userEvent.type(input, 'a b');
      expect(within(dialog).getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
      expect(api.checkNickname).not.toHaveBeenCalled();
    });

    it('Cancel discards the changes: reopening shows the saved values', async () => {
      const dialog = await openEditor();
      const input = within(dialog).getByLabelText('Nickname');
      await userEvent.type(input, 'zzz');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await userEvent.click(screen.getByRole('button', { name: /edit profile/i }));
      expect((await screen.findByLabelText('Nickname')).value).toBe('Maya_1');
      expect(api.updateProfile).not.toHaveBeenCalled();
    });
  });
});

describe('rules page', () => {
  it('shows Normal Mode without a tab bar while it is the only mode', async () => {
    renderAt('/rules');
    await screen.findByText('Normal Mode');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('pictures the cards next to the deck description', async () => {
    renderAt('/rules');
    const cards = await screen.findByRole('list', { name: 'What the cards look like' });
    for (const name of ['Number card 7', 'Freeze', 'Flip Three', 'Second Chance']) expect(within(cards).getByRole('img', { name })).toBeTruthy();
  });

  it('shows the Normal Mode rules from the owner\'s document', async () => {
    renderAt('/rules');
    await screen.findByRole('heading', { name: 'Goal' });
    expect(screen.queryByRole('note')).toBeNull();
    for (const heading of ['The deck (94 cards)', 'Busting and Second Chance', 'Flip 7 bonus', 'Ending a round and scoring']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    expect(screen.getByText(/15 point bonus/i)).toBeTruthy();
  });

  it('the data lists only Normal Mode, with the 200-point end condition', () => {
    expect(MODE_RULES.map((m) => m.id)).toEqual(['normal']);
    expect(MODE_RULES[0].sections.length).toBeGreaterThan(5);
    expect(JSON.stringify(MODE_RULES[0].sections)).toMatch(/200 points/);
  });

  it('has a way back to the lobby', async () => {
    renderAt('/rules');
    expect((await screen.findByRole('link', { name: /lobby/i })).getAttribute('href')).toBe('/lobby');
  });

  it('is protected: visitors are sent to login', async () => {
    api.getMe.mockResolvedValue({ user: null, pendingProfile: null, csrfToken: null });
    const router = renderAt('/rules');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(router.state.location.pathname).toBe('/login');
  });
});
