import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '../app/AuthProvider.jsx';
import { routes } from '../app/router.jsx';
import * as api from '../services/api.js';
import { ApiError } from '../services/api.js';
import * as socketModule from '../services/socket.js';

// A controllable stand-in for the live connection: tests call fakeSocket.pushState(...) etc.
const fakeSocket = { handlers: null, close: vi.fn() };
vi.mock('../services/socket.js', () => ({
  openRoomSocket: vi.fn((handlers) => {
    fakeSocket.handlers = handlers;
    return { close: fakeSocket.close };
  }),
}));

vi.mock('../services/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getMe: vi.fn(), getProfile: vi.fn(), getMyMatches: vi.fn(),
  getCurrentRoom: vi.fn(), getRoomModes: vi.fn(), createRoom: vi.fn(), joinRoom: vi.fn(),
  leaveRoom: vi.fn(), startGame: vi.fn(), answerStartPrompt: vi.fn(), removePlayer: vi.fn(),
}));

const USER = { id: 1, nickname: 'Maya_1', email: 'm@example.com', avatar: 'fox', totalPoints: 0 };
const player = (id, nickname, isCreator = false) => ({ id, nickname, avatar: 'cat', isCreator });
function makeRoom(overrides = {}) {
  const now = Date.now();
  return {
    code: 'ABC234', status: 'Waiting', gameMode: { id: 1, name: 'Normal' }, maxPlayers: 4, minPlayers: 3,
    playerCount: 2, creatorId: 1, isCreator: true, canStart: false,
    players: [player(1, 'Maya_1', true), player(2, 'Sam')], startPrompt: null, nextPromptAt: null,
    serverNow: now, version: 1, ...overrides,
  };
}

function renderAt(path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<AuthProvider><RouterProvider router={router} /></AuthProvider>);
  return router;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getMe.mockResolvedValue({ user: USER, pendingProfile: null, csrfToken: 'tok' });
  api.getCurrentRoom.mockResolvedValue({ room: null });
  api.getRoomModes.mockResolvedValue({ modes: [{ id: 1, name: 'Normal' }] });
  fakeSocket.handlers = null;
  socketModule.openRoomSocket.mockImplementation((handlers) => {
    fakeSocket.handlers = handlers;
    return { close: fakeSocket.close };
  });
});

describe('create dialog', () => {
  async function open() {
    renderAt('/lobby');
    await userEvent.click(await screen.findByRole('button', { name: /create game/i }));
    return screen.findByRole('dialog', { name: /create a game/i });
  }

  it('hides the mode choice while there is only one mode, offers 3-12 players and sends the choice, then opens the room', async () => {
    api.createRoom.mockResolvedValue({ room: makeRoom({ maxPlayers: 6 }) });
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom({ maxPlayers: 6 }) });
    const dialog = await open();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create room' }).disabled).toBe(false)); // the mode has loaded
    expect(within(dialog).queryByText('Game mode')).toBeNull();
    expect(within(dialog).getAllByRole('radio', { name: /^([3-9]|1[0-2])$/ })).toHaveLength(10);
    await userEvent.click(within(dialog).getByRole('radio', { name: '6' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create room' }));
    await waitFor(() => expect(api.createRoom).toHaveBeenCalledWith({ gameModeId: 1, maxPlayers: 6 }));
    await screen.findByRole('heading', { name: 'Waiting room' });
  });

  it('shows the server error and stays open', async () => {
    api.createRoom.mockRejectedValue(new ApiError(503, 'ROOM_CODE_UNAVAILABLE', 'x'));
    const dialog = await open();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Create room' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/room code/i);
  });
});

describe('join dialog', () => {
  async function open() {
    renderAt('/lobby');
    await userEvent.click(await screen.findByRole('button', { name: /join game/i }));
    return screen.findByRole('dialog', { name: /join a game/i });
  }
  const fill = async (dialog, code) => {
    await userEvent.type(within(dialog).getByLabelText('Room code'), code);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Join' }));
  };

  it('joins and opens the room', async () => {
    api.joinRoom.mockResolvedValue({ room: makeRoom() });
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom() });
    await fill(await open(), 'abc234');
    expect(api.joinRoom).toHaveBeenCalledWith('ABC234');
    await screen.findByRole('heading', { name: 'Waiting room' });
  });

  it.each([
    ['ROOM_NOT_FOUND', /no room with that code/i],
    ['ROOM_FULL', /full/i],
    ['GAME_IN_PROGRESS', /already started/i],
  ])('explains %s', async (code, pattern) => {
    api.joinRoom.mockRejectedValue(new ApiError(409, code, 'raw'));
    const dialog = await open();
    await fill(dialog, 'ABCD');
    await waitFor(() => expect(within(dialog).getByText(pattern)).toBeTruthy());
  });

  it('links back to the room the player is already in', async () => {
    api.joinRoom.mockRejectedValue(new ApiError(409, 'ALREADY_IN_OTHER_ROOM', 'x', { code: 'XYZ789' }));
    const dialog = await open();
    await fill(dialog, 'ABCD');
    const link = await within(dialog).findByRole('link', { name: /XYZ789/ });
    expect(link.getAttribute('href')).toBe('/rooms/XYZ789');
  });
});

describe('lobby banner', () => {
  it('offers to return to the current room', async () => {
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom() });
    renderAt('/lobby');
    const link = await screen.findByRole('link', { name: /return to room ABC234/i });
    expect(link.getAttribute('href')).toBe('/rooms/ABC234');
    // it is now the one highlighted action; Create Game is an ordinary card
    expect(link.className).toMatch(/lobby-action--primary/);
    expect(screen.getByRole('button', { name: /create game/i }).className).not.toMatch(/lobby-action--primary/);
  });
});

describe('room page', () => {
  it('shows the code, players, open seats and the host badge', async () => {
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom() });
    renderAt('/rooms/ABC234');
    await screen.findByRole('heading', { name: 'Waiting room' });
    expect(screen.getByText('ABC234')).toBeTruthy();
    expect(screen.getByText('Sam')).toBeTruthy();
    expect(screen.getByText('Host')).toBeTruthy();
    expect(screen.getAllByLabelText('Open seat')).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toMatch(/2 of 4 players \(at least 3 needed/);
  });

  it('says the room is closed when the player is in none', async () => {
    renderAt('/rooms/ABC234');
    expect((await screen.findByRole('heading', { name: /room is closed/i })).textContent).toBeTruthy();
  });

  it('redirects to the room the player is really in', async () => {
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom() });
    const router = renderAt('/rooms/OTHER1');
    await screen.findByRole('heading', { name: 'Waiting room' });
    expect(router.state.location.pathname).toBe('/rooms/ABC234');
  });

  it('shows the host the start question with a countdown, and Yes starts', async () => {
    const room = makeRoom({ playerCount: 3, canStart: true, startPrompt: { autoStartAt: Date.now() + 90_000 },
      players: [player(1, 'Maya_1', true), player(2, 'Sam'), player(3, 'Lee')] });
    api.getCurrentRoom.mockResolvedValue({ room });
    api.answerStartPrompt.mockResolvedValue({ room: { ...room, status: 'In Progress', startPrompt: null } });
    renderAt('/rooms/ABC234');
    await screen.findByRole('heading', { name: /start the game now/i });
    expect(screen.getByText(/1:(2|3)\d/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /yes, start/i }));
    expect(api.answerStartPrompt).toHaveBeenCalledWith('yes');
    await screen.findByRole('heading', { name: /game is starting/i });
  });

  it('"Not yet" sends no and shows when the next question comes', async () => {
    const room = makeRoom({ playerCount: 3, canStart: true, startPrompt: { autoStartAt: Date.now() + 90_000 } });
    api.getCurrentRoom.mockResolvedValue({ room });
    api.answerStartPrompt.mockResolvedValue({ room: { ...room, startPrompt: null, nextPromptAt: Date.now() + 120_000 } });
    renderAt('/rooms/ABC234');
    await userEvent.click(await screen.findByRole('button', { name: /not yet/i }));
    expect(api.answerStartPrompt).toHaveBeenCalledWith('no');
    expect(await screen.findByRole('button', { name: /start game/i })).toBeTruthy();
    expect(screen.getByText(/asked again in/i)).toBeTruthy();
  });

  it('guests never see host controls', async () => {
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom({ playerCount: 3, isCreator: false, creatorId: 2 }) });
    renderAt('/rooms/ABC234');
    await screen.findByText(/waiting for the host/i);
    expect(screen.queryByRole('button', { name: /start/i })).toBeNull();
  });

  it('Leave room calls the backend and returns to the lobby', async () => {
    api.getCurrentRoom.mockResolvedValueOnce({ room: makeRoom() }).mockResolvedValue({ room: null });
    api.leaveRoom.mockResolvedValue({ closed: true });
    const router = renderAt('/rooms/ABC234');
    await userEvent.click(await screen.findByRole('button', { name: /leave room/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/lobby'));
    expect(api.leaveRoom).toHaveBeenCalled();
  });
});

describe('host: manage players (kick / ban)', () => {
  const others = (canKick = true) => [player(1, 'Maya_1', true), { ...player(2, 'Sam'), canKick }, { ...player(3, 'Lee'), canKick }];
  async function open(room) {
    api.getCurrentRoom.mockResolvedValue({ room });
    renderAt('/rooms/ABC234');
    await userEvent.click(await screen.findByRole('button', { name: 'Manage players' }));
    return screen.findByRole('dialog', { name: 'Manage players' });
  }

  it('guests have no such button', async () => {
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom({ isCreator: false, creatorId: 2 }) });
    renderAt('/rooms/ABC234');
    await screen.findByRole('heading', { name: 'Waiting room' });
    expect(screen.queryByRole('button', { name: 'Manage players' })).toBeNull();
  });

  it('kicking asks first: Cancel changes nothing, confirming sends the kick', async () => {
    const room = makeRoom({ playerCount: 3, players: others() });
    api.removePlayer.mockResolvedValue({ room: makeRoom({ version: 2, players: others().slice(0, 2) }) });
    const dialog = await open(room);
    expect(within(dialog).queryByRole('button', { name: /maya/i })).toBeNull(); // the host is not in their own list
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kick Lee' }));
    const question = await screen.findByRole('dialog', { name: 'Kick Lee?' });
    await userEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(api.removePlayer).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Kick Lee' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Kick Lee?' })).getByRole('button', { name: 'Kick Lee' }));
    expect(api.removePlayer).toHaveBeenCalledWith(3, false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('banning warns that it cannot be undone, then sends the ban', async () => {
    api.removePlayer.mockResolvedValue({ room: makeRoom({ version: 2 }) });
    const dialog = await open(makeRoom({ playerCount: 3, players: others() }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ban Sam' }));
    const question = await screen.findByRole('dialog', { name: 'Ban Sam?' });
    expect(question.textContent).toMatch(/cannot join it again.*cannot be undone/i);
    await userEvent.click(within(question).getByRole('button', { name: 'Ban Sam' }));
    expect(api.removePlayer).toHaveBeenCalledWith(2, true);
  });

  it('greys out Kick and says why when the server locks it; Ban stays available', async () => {
    const dialog = await open(makeRoom({ playerCount: 3, players: others(false) }));
    expect(within(dialog).getByRole('button', { name: 'Kick Sam' }).disabled).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Ban Sam' }).disabled).toBe(false);
    expect(within(dialog).getByText(/needs at least 3 players/i)).toBeTruthy();
  });

  it('shows the server error inside the dialog', async () => {
    api.removePlayer.mockRejectedValue(new ApiError(404, 'PLAYER_NOT_IN_ROOM', 'x'));
    const dialog = await open(makeRoom({ playerCount: 3, players: others() }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kick Sam' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Kick Sam?' })).getByRole('button', { name: 'Kick Sam' }));
    expect((await within(await screen.findByRole('dialog', { name: 'Manage players' })).findByRole('alert')).textContent).toMatch(/no longer in the room/i);
  });

  it('a removed player is told the host did it', async () => {
    api.getCurrentRoom.mockResolvedValueOnce({ room: makeRoom({ isCreator: false, creatorId: 2 }) }).mockResolvedValue({ room: null });
    renderAt('/rooms/ABC234');
    await screen.findByText('Sam');
    await act(() => fakeSocket.handlers.onState(null, 'banned'));
    expect(await screen.findByRole('heading', { name: /you were removed/i })).toBeTruthy();
    expect(screen.getByText(/banned you from this room/i)).toBeTruthy();
  });
});

describe('live updates', () => {
  const push = (room) => act(() => fakeSocket.handlers.onState(room));
  const status = (value) => act(() => fakeSocket.handlers.onStatus(value));

  it('shows changes pushed by the server without any request', async () => {
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom({ version: 1 }) });
    renderAt('/rooms/ABC234');
    await screen.findByText('Sam');
    const calls = api.getCurrentRoom.mock.calls.length;
    await push(makeRoom({ version: 2, playerCount: 3, players: [player(1, 'Maya_1', true), player(2, 'Sam'), player(3, 'Lee')] }));
    expect(screen.getByText('Lee')).toBeTruthy();
    expect(api.getCurrentRoom.mock.calls.length).toBe(calls);
  });

  it('ignores an update older than the one already shown', async () => {
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom({ version: 5 }) });
    renderAt('/rooms/ABC234');
    await screen.findByText('Sam');
    await push(makeRoom({ version: 3, playerCount: 1, players: [player(1, 'Maya_1', true)] }));
    expect(screen.getByText('Sam')).toBeTruthy();
  });

  it('closing the room (null pushed) shows the closed message', async () => {
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom() });
    renderAt('/rooms/ABC234');
    await screen.findByText('Sam');
    await push(null);
    expect(await screen.findByRole('heading', { name: /room is closed/i })).toBeTruthy();
  });

  it('warns while reconnecting, and again says nothing once live', async () => {
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom() });
    renderAt('/rooms/ABC234');
    await screen.findByText('Sam');
    await status('reconnecting');
    expect(screen.getByText(/connection lost/i)).toBeTruthy();
    await status('live');
    expect(screen.queryByText(/connection lost/i)).toBeNull();
  });

  it('tells the player to reload when live updates are off', async () => {
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom() });
    renderAt('/rooms/ABC234');
    await screen.findByText('Sam');
    await status('offline');
    expect(screen.getByText(/reload the page/i)).toBeTruthy();
  });

  it('closes the connection when leaving the page', async () => {
    api.getCurrentRoom.mockResolvedValue({ room: makeRoom() });
    const router = renderAt('/rooms/ABC234');
    await screen.findByText('Sam');
    await act(() => router.navigate('/lobby'));
    expect(fakeSocket.close).toHaveBeenCalled();
  });
});
