import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '../app/AuthProvider.jsx';
import { routes } from '../app/router.jsx';
import * as api from '../services/api.js';
import * as socketModule from '../services/socket.js';
import { describeEvent } from '../features/game/describeEvent.js';

const fakeSocket = { handlers: null, close: vi.fn() };
vi.mock('../services/socket.js', () => ({ openRoomSocket: vi.fn() }));
vi.mock('../services/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getMe: vi.fn(), getProfile: vi.fn(), getMyMatches: vi.fn(), getCurrentRoom: vi.fn(),
  getRoomModes: vi.fn(), leaveRoom: vi.fn(), sendGameAction: vi.fn(), setReady: vi.fn(), startRematch: vi.fn(),
}));

const ME = 1;
const USER = { id: ME, nickname: 'Maya', email: 'm@example.test', avatar: 'fox', totalPoints: 0 };
const NAMES = { 1: 'Maya', 2: 'Sam', 3: 'Lee' };

const seat = (id, extra = {}) => ({
  id, total: 0, left: false, status: 'active', numbers: [], modifiers: [], hasSecondChance: false, flip7: false, roundScore: 0, ...extra,
});
function makeGame(extra = {}) {
  return {
    seq: 5, phase: 'playing', targetScore: 200, roundNumber: 2, dealerId: 3,
    players: [seat(1, { numbers: [3, 8], roundScore: 11, total: 40 }), seat(2, { numbers: [5], modifiers: ['+4'], roundScore: 9, total: 25 }), seat(3, { status: 'stayed', numbers: [12], hasSecondChance: true, roundScore: 12, total: 60 })],
    drawCount: 70, discardCount: 14,
    decision: { id: 7, type: 'hit_or_stay', playerId: ME, card: null, options: null },
    lastRound: null, result: null, events: [],
    timer: { kind: 'turn', endsAt: Date.now() + 12_000 }, turnSeconds: 15,
    ...extra,
  };
}
function makeRoom(game, extra = {}) {
  return {
    code: 'ABC234', status: 'In Progress', gameMode: { id: 1, name: 'Normal' }, maxPlayers: 4, minPlayers: 3, playerCount: 3,
    creatorId: 1, isCreator: true, canStart: false,
    players: [1, 2, 3].map((id) => ({ id, nickname: NAMES[id], avatar: 'cat', isCreator: id === 1 })),
    startPrompt: null, nextPromptAt: null, serverNow: Date.now(), version: 1, game, ...extra,
  };
}
function renderRoom(room) {
  api.getCurrentRoom.mockResolvedValue({ room });
  const router = createMemoryRouter(routes, { initialEntries: ['/rooms/ABC234'] });
  render(<AuthProvider><RouterProvider router={router} /></AuthProvider>);
  return router;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getMe.mockResolvedValue({ user: USER, pendingProfile: null, csrfToken: 'tok' });
  api.getCurrentRoom.mockResolvedValue({ room: null });
  api.sendGameAction.mockResolvedValue({ room: null });
  socketModule.openRoomSocket.mockImplementation((handlers) => {
    fakeSocket.handlers = handlers;
    return { close: fakeSocket.close };
  });
});

describe('the table', () => {
  it('shows the round, dealer, target, deck size and every player with totals and cards', async () => {
    renderRoom(makeRoom(makeGame()));
    await screen.findByLabelText('Game table');
    const bar = screen.getByLabelText('Game table').querySelector('.game__bar');
    expect(bar.textContent).toMatch(/Round 2/);
    expect(bar.textContent).toMatch(/Dealer: Lee/);
    expect(bar.textContent).toMatch(/First to 200/);
    expect(bar.textContent).toMatch(/Deck: 70/);
    const seats = within(screen.getByRole('list', { name: 'Players' })).getAllByRole('listitem');
    expect(seats).toHaveLength(3);
    expect(within(seats[0]).getByText('Maya (you)')).toBeTruthy();
    expect(within(seats[0]).getByLabelText('40 points in total')).toBeTruthy();
    expect(within(seats[0]).getByLabelText('Card 3')).toBeTruthy();
    expect(within(seats[0]).getByLabelText('Card 8')).toBeTruthy();
    expect(within(seats[1]).getByText('+4')).toBeTruthy();
    expect(within(seats[2]).getByText('Stayed')).toBeTruthy();
    expect(within(seats[2]).getByText('2nd Chance')).toBeTruthy();
    expect(within(seats[2]).getByText('Dealer')).toBeTruthy();
  });

  it('marks busted and departed players, and the Flip 7 holder', async () => {
    const game = makeGame({ players: [seat(1), seat(2, { status: 'busted', numbers: [5, 5] }), seat(3, { left: true, status: 'left' })] });
    renderRoom(makeRoom(game));
    await screen.findByLabelText('Game table');
    expect(screen.getByText('Bust!')).toBeTruthy();
    expect(screen.getByText('Left')).toBeTruthy();
  });

  it('the waiting-room page is replaced by the table once a game exists', async () => {
    renderRoom(makeRoom(makeGame()));
    await screen.findByLabelText('Game table');
    expect(screen.queryByRole('heading', { name: 'Waiting room' })).toBeNull();
  });
});

describe('answering Hit or Stay', () => {
  it('shows Hit and Stay with a countdown when it is my turn, and sends the choice with the question number', async () => {
    renderRoom(makeRoom(makeGame()));
    await screen.findByRole('group', { name: 'Your turn' });
    expect(screen.getByRole('timer').textContent).toMatch(/0:1[12]/);
    await userEvent.click(screen.getByRole('button', { name: 'Hit' }));
    expect(api.sendGameAction).toHaveBeenCalledWith({ decisionId: 7, type: 'hit' });
    await userEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(api.sendGameAction).toHaveBeenLastCalledWith({ decisionId: 7, type: 'stay' });
  });

  it('tells me when I am NOT the one being asked and offers no buttons', async () => {
    const game = makeGame({ decision: { id: 8, type: 'hit_or_stay', playerId: 2, card: null, options: null } });
    renderRoom(makeRoom(game));
    const waiting = await screen.findByText(/Waiting for/);
    expect(waiting.textContent).toMatch(/Waiting for Sam/);
    expect(screen.queryByRole('button', { name: 'Hit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stay' })).toBeNull();
  });

  it('warns visually when the time is nearly up', async () => {
    const game = makeGame({ timer: { kind: 'turn', endsAt: Date.now() + 3000 } });
    renderRoom(makeRoom(game));
    const timer = await screen.findByRole('timer');
    expect(timer.className).toMatch(/timer--urgent/);
  });

  it('shows the error and refreshes when the server refuses a move', async () => {
    api.sendGameAction.mockRejectedValue(new api.ApiError(409, 'NOT_YOUR_TURN', 'raw'));
    renderRoom(makeRoom(makeGame()));
    await userEvent.click(await screen.findByRole('button', { name: 'Hit' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not your turn/i);
    expect(api.getCurrentRoom.mock.calls.length).toBeGreaterThan(1);
  });

  it('too many moves too fast: says to wait a moment, not the server\'s "few minutes"', async () => {
    api.sendGameAction.mockRejectedValue(new api.ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a few minutes and try again.'));
    renderRoom(makeRoom(makeGame()));
    await userEvent.click(await screen.findByRole('button', { name: 'Hit' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/wait a moment/i);
    expect(alert.textContent).not.toMatch(/minutes/i);
    expect(api.getCurrentRoom.mock.calls.length).toBeGreaterThan(1);
  });

  it('applies the new table the server sends back after a move', async () => {
    const after = makeGame({ seq: 6, decision: { id: 8, type: 'hit_or_stay', playerId: 2, card: null, options: null } });
    api.sendGameAction.mockResolvedValue({ room: makeRoom(after) });
    renderRoom(makeRoom(makeGame()));
    await userEvent.click(await screen.findByRole('button', { name: 'Stay' }));
    await screen.findByText(/Waiting for/);
  });
});

describe('Action card choices', () => {
  it('Freeze: lists the players I can pick, including myself', async () => {
    const game = makeGame({ decision: { id: 9, type: 'choose_target', playerId: ME, card: 'freeze', options: [1, 2] } });
    renderRoom(makeRoom(game));
    const panel = await screen.findByRole('group', { name: 'Play Freeze' });
    expect(within(panel).getByText('You drew Freeze')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Lee' })).toBeNull(); // Lee already stayed: not an option
    await userEvent.click(within(panel).getByRole('button', { name: 'Sam' }));
    expect(api.sendGameAction).toHaveBeenCalledWith({ decisionId: 9, type: 'target', targetId: 2 });
    await userEvent.click(within(panel).getByRole('button', { name: 'Myself' }));
    expect(api.sendGameAction).toHaveBeenLastCalledWith({ decisionId: 9, type: 'target', targetId: ME });
  });

  it('Freeze: the players I can pick light up on the table, and clicking a row gives them the card', async () => {
    const game = makeGame({ decision: { id: 9, type: 'choose_target', playerId: ME, card: 'freeze', options: [1, 2] } });
    renderRoom(makeRoom(game));
    await screen.findByRole('group', { name: 'Play Freeze' });
    const seats = within(screen.getByRole('list', { name: 'Players' })).getAllByRole('listitem');
    expect(seats.map((s) => s.className.includes('seat--pickable'))).toEqual([true, true, false]); // Lee is not an option
    expect(within(seats[2]).queryByRole('button')).toBeNull();
    await userEvent.click(within(seats[1]).getByRole('button', { name: 'Give Freeze to Sam' }));
    expect(api.sendGameAction).toHaveBeenCalledWith({ decisionId: 9, type: 'target', targetId: 2 });
    await userEvent.click(within(seats[0]).getByRole('button', { name: 'Give Freeze to myself' }));
    expect(api.sendGameAction).toHaveBeenLastCalledWith({ decisionId: 9, type: 'target', targetId: ME });
  });

  it('nobody can be picked on the table while someone else is choosing', async () => {
    const game = makeGame({ decision: { id: 9, type: 'choose_target', playerId: 2, card: 'freeze', options: [1, 2, 3] } });
    renderRoom(makeRoom(game));
    await screen.findByText(/Waiting for/);
    expect(document.querySelector('.seat--pickable, .seat__pick')).toBeNull();
  });

  it('a frozen player\'s row is covered in ice', async () => {
    const game = makeGame({ players: [seat(1), seat(2, { status: 'frozen', numbers: [4] }), seat(3)] });
    renderRoom(makeRoom(game));
    await screen.findByLabelText('Game table');
    const seats = within(screen.getByRole('list', { name: 'Players' })).getAllByRole('listitem');
    expect(seats.map((s) => Boolean(s.querySelector('.seat__ice')))).toEqual([false, true, false]);
    expect(within(seats[1]).getByText('Frozen')).toBeTruthy();
  });

  it('Flip Three explains what it does', async () => {
    const game = makeGame({ decision: { id: 9, type: 'choose_target', playerId: ME, card: 'flip_three', options: [1, 2, 3] } });
    renderRoom(makeRoom(game));
    await screen.findByRole('group', { name: 'Play Flip Three' });
    expect(screen.getByText(/must take the next three cards/i)).toBeTruthy();
  });

  it('a spare Second Chance is given with a "gift" move', async () => {
    const game = makeGame({ decision: { id: 11, type: 'choose_gift', playerId: ME, card: 'second_chance', options: [2, 3] } });
    renderRoom(makeRoom(game));
    const panel = await screen.findByRole('group', { name: 'Give a Second Chance' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Lee' }));
    expect(api.sendGameAction).toHaveBeenCalledWith({ decisionId: 11, type: 'gift', targetId: 3 });
  });

  it('others see who is choosing and what for', async () => {
    const game = makeGame({ decision: { id: 9, type: 'choose_target', playerId: 2, card: 'freeze', options: [1, 2, 3] } });
    renderRoom(makeRoom(game));
    await screen.findByText(/to play Freeze/);
  });
});

describe('between rounds and at the end', () => {
  const scores = [
    { id: 1, status: 'stayed', roundScore: 11, total: 51, flip7: false },
    { id: 2, status: 'busted', roundScore: 0, total: 25, flip7: false },
    { id: 3, status: 'stayed', roundScore: 43, total: 103, flip7: true },
  ];

  it('shows the round summary, best total first, with the countdown to the next round', async () => {
    const game = makeGame({ phase: 'round_over', decision: null, timer: { kind: 'next_round', endsAt: Date.now() + 6000 }, lastRound: { number: 2, endReason: 'flip7', scores } });
    renderRoom(makeRoom(game));
    await screen.findByRole('heading', { name: 'Round 2 is over' });
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell').pop().textContent)).toEqual(['103', '51', '25']);
    expect(within(rows[0]).getByRole('rowheader').textContent).toMatch(/Lee.*Flip 7/);
    expect(within(rows[2]).getByText('Bust (0)')).toBeTruthy();
    expect(screen.getByText(/Next round in [56] s/)).toBeTruthy();
  });

  const finished = (extra = {}) =>
    makeGame({
      phase: 'finished', decision: null, timer: null,
      result: {
        reason: 'target_reached', rounds: 6, winnerIds: [3],
        standings: [
          { userId: 3, finalPoints: 214, rankingPoints: 214, hits: 9, busts: 1, left: false },
          { userId: 1, finalPoints: 150, rankingPoints: 150, hits: 7, busts: 2, left: false },
          { userId: 2, finalPoints: 0, rankingPoints: 0, hits: 3, busts: 0, left: true },
        ],
      },
      ...extra,
    });

  it('announces the winner and lists everyone, with leavers marked and on 0', async () => {
    renderRoom(makeRoom(finished()));
    await screen.findByRole('heading', { name: 'Lee wins!' });
    expect(screen.getByText(/Lee reached 214 points\. The match lasted 6 rounds\. You finished 2nd of 3\./)).toBeTruthy();
    const rows = [...document.querySelectorAll('.standings li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual([
      '1Lee214 pts +214 rankingNot ready',
      '2Maya (you)150 pts +150 rankingNot ready',
      '3SamLeft0 pts +0 rankingNot ready',
    ]);
  });

  describe('play again', () => {
    const over = (extra = {}) => makeRoom(finished(), { matchOver: true, readyIds: [], canRematch: true, ...extra });

    it('offers "Play again" and sends the choice', async () => {
      api.setReady.mockResolvedValue({ room: over({ readyIds: [ME] }) });
      renderRoom(over());
      expect(await screen.findByText(/0 of 3 ready/)).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Play again' }));
      expect(api.setReady).toHaveBeenCalledWith(true);
      expect(await screen.findByRole('button', { name: /not ready after all/i })).toBeTruthy();
      expect(screen.getByText(/1 of 3 ready/)).toBeTruthy();
    });

    it('lets you change your mind', async () => {
      api.setReady.mockResolvedValue({ room: over() });
      renderRoom(over({ readyIds: [ME, 2] }));
      expect(await screen.findByText(/2 of 3 ready/)).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: /not ready after all/i }));
      expect(api.setReady).toHaveBeenCalledWith(false);
    });

    it('marks who is ready in the table', async () => {
      renderRoom(over({ readyIds: [3] }));
      await screen.findByText(/1 of 3 ready/);
      const rowOf = (name) => [...document.querySelectorAll('.standings li')].find((li) => li.textContent.includes(name));
      expect(within(rowOf('Lee')).getByText('Ready')).toBeTruthy();
      expect(within(rowOf('Maya')).getByText('Not ready')).toBeTruthy();
    });

    it('the host can start without the ones who are not ready', async () => {
      api.startRematch.mockResolvedValue({ room: makeRoom(makeGame()) });
      renderRoom(over({ readyIds: [2, 3], canStartWithReady: true, playerCount: 4 }));
      await userEvent.click(await screen.findByRole('button', { name: /start now with the players who are ready/i }));
      expect(api.startRematch).toHaveBeenCalledTimes(1);
    });

    it('the button is not offered to others, or when it would not work', async () => {
      renderRoom(over({ readyIds: [2], isCreator: false, canStartWithReady: false }));
      await screen.findByRole('button', { name: 'Play again' });
      expect(screen.queryByRole('button', { name: /start now/i })).toBeNull();
    });

    it('the button is not needed when everyone is ready (the match starts by itself)', async () => {
      renderRoom(over({ readyIds: [1, 2, 3], canStartWithReady: true }));
      await screen.findByText(/3 of 3 ready/);
      expect(screen.queryByRole('button', { name: /start now/i })).toBeNull();
    });

    it('lists the members who were not in the match, with their ready state', async () => {
      const players = [1, 2, 3, 4].map((id) => ({ id, nickname: { ...NAMES, 4: 'Zed' }[id], avatar: 'cat', isCreator: id === 1 }));
      renderRoom(over({ players, playerCount: 4, readyIds: [4] }));
      const list = await screen.findByRole('list', { name: /not in this match/i });
      expect(within(list).getByText('Zed')).toBeTruthy();
      expect(within(list).getByText('Ready')).toBeTruthy();
    });

    it('with too few players left it says so and offers no button', async () => {
      renderRoom(over({ canRematch: false, playerCount: 2 }));
      await screen.findByText(/not enough players are left/i);
      expect(screen.queryByRole('button', { name: 'Play again' })).toBeNull();
    });

    it('a failed request shows the message', async () => {
      api.setReady.mockRejectedValue(Object.assign(new Error('x'), { code: 'MATCH_NOT_OVER' }));
      renderRoom(over());
      await userEvent.click(await screen.findByRole('button', { name: 'Play again' }));
      expect(await screen.findByRole('alert')).toBeTruthy();
    });
  });

  it('says "You win!" to the winner', async () => {
    renderRoom(makeRoom(finished({ result: { ...finished().result, winnerIds: [ME] } })));
    await screen.findByRole('heading', { name: 'You win!' });
  });

  it('explains a win by everyone else leaving', async () => {
    renderRoom(makeRoom(finished({ result: { ...finished().result, reason: 'last_player', winnerIds: [ME] } })));
    await screen.findByText(/Everyone else left the match/);
  });

  it('leaving after the match needs no confirmation', async () => {
    api.leaveRoom.mockResolvedValue({ closed: false });
    const router = renderRoom(makeRoom(finished()));
    await userEvent.click(await screen.findByRole('button', { name: /leave match/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.leaveRoom).toHaveBeenCalledWith(false);
    await waitFor(() => expect(router.state.location.pathname).toBe('/lobby'));
  });
});

describe('watching a match', () => {
  it('says you are watching, and leaving needs no confirmation', async () => {
    api.leaveRoom.mockResolvedValue({ closed: false });
    const players = [1, 2, 3, 4].map((id) => ({ id, nickname: { ...NAMES, 4: 'Zed' }[id], avatar: 'cat', isCreator: id === 2, isSpectator: id === ME }));
    const router = renderRoom(makeRoom(makeGame({ decision: { id: 7, type: 'hit_or_stay', playerId: 2, card: null, options: null } }), { isSpectator: true, isCreator: false, creatorId: 2, players, playerCount: 4 }));
    await screen.findByText(/you are watching this match/i);
    expect(screen.queryByRole('button', { name: /^hit$/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /leave match/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.leaveRoom).toHaveBeenCalledWith(false);
    await waitFor(() => expect(router.state.location.pathname).toBe('/lobby'));
  });
});

describe('leaving a running match', () => {
  it('asks first and says the points are lost; cancelling changes nothing', async () => {
    renderRoom(makeRoom(makeGame()));
    await userEvent.click(await screen.findByRole('button', { name: /leave match/i }));
    const dialog = await screen.findByRole('dialog', { name: /leave the match/i });
    expect(within(dialog).getByText(/no points/i)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: /stay in the match/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.leaveRoom).not.toHaveBeenCalled();
  });

  it('only a confirmed leave reaches the server, then the player returns to the lobby', async () => {
    api.leaveRoom.mockResolvedValue({ closed: false });
    const router = renderRoom(makeRoom(makeGame()));
    await userEvent.click(await screen.findByRole('button', { name: /leave match/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /leave and lose my points/i }));
    await waitFor(() => expect(api.leaveRoom).toHaveBeenCalledWith(true));
    await waitFor(() => expect(router.state.location.pathname).toBe('/lobby'));
  });
});

describe('live updates of the table', () => {
  it('a pushed state changes the table (a new turn, new cards)', async () => {
    renderRoom(makeRoom(makeGame()));
    await screen.findByRole('group', { name: 'Your turn' });
    const next = makeGame({ seq: 6, decision: { id: 8, type: 'hit_or_stay', playerId: 3, card: null, options: null } });
    await act(() => fakeSocket.handlers.onState(makeRoom(next, { version: 2 })));
    expect(screen.queryByRole('group', { name: 'Your turn' })).toBeNull();
  });

  it('keeps a leaver\'s name on the scoreboard after they vanish from the room list', async () => {
    const room = makeRoom(makeGame({ phase: 'finished', decision: null, timer: null, result: {
      reason: 'last_player', rounds: 1, winnerIds: [ME],
      standings: [{ userId: ME, finalPoints: 10, rankingPoints: 10, hits: 1, busts: 0, left: false }, { userId: 2, finalPoints: 0, rankingPoints: 0, hits: 0, busts: 0, left: true }],
    } }));
    renderRoom(room);
    await screen.findByRole('heading', { name: 'You win!' });
    const afterLeave = { ...room, version: 2, players: room.players.filter((p) => p.id !== 2) };
    await act(() => fakeSocket.handlers.onState(afterLeave));
    expect(screen.getAllByText('Sam').length).toBeGreaterThan(0);
  });
});

describe('describeEvent', () => {
  const nameOf = (id) => NAMES[id] ?? 'A player';
  const card = (label) => ({ id: 1, kind: 'number', label });
  it.each([
    [{ type: 'round_started', round: 3, dealerId: 2 }, 'Round 3 begins. Sam is the dealer.'],
    [{ type: 'card_dealt', playerId: 1, via: 'deal', card: card('7') }, 'Maya is dealt 7.'],
    [{ type: 'card_dealt', playerId: 1, via: 'hit', card: card('7') }, 'Maya draws 7.'],
    [{ type: 'card_dealt', playerId: 1, via: 'flip_three', card: card('7') }, 'Maya is forced to draw 7.'],
    [{ type: 'player_stayed', playerId: 2, roundScore: 12 }, 'Sam stays with 12 points.'],
    [{ type: 'player_busted', playerId: 2, card: card('5') }, 'Sam busts with a second 5!'],
    [{ type: 'flip_three_stopped', playerId: 2, remaining: 2 }, 'Flip Three stops: the other 2 cards stay on the deck.'],
    [{ type: 'flip_three_stopped', playerId: 2, remaining: 1 }, 'Flip Three stops: the last card stays on the deck.'],
    [{ type: 'second_chance_used', playerId: 3, card: card('5') }, "Lee's Second Chance cancels the duplicate 5."],
    [{ type: 'second_chance_given', playerId: 1, targetId: 2 }, 'Maya gives a Second Chance to Sam.'],
    [{ type: 'action_resolved', playerId: 1, targetId: 1, card: { label: 'Freeze' } }, 'Maya plays Freeze on themselves.'],
    [{ type: 'action_resolved', playerId: 1, targetId: 3, card: { label: 'Flip Three' } }, 'Maya plays Flip Three on Lee.'],
    [{ type: 'flip7_achieved', playerId: 3 }, 'Lee flips 7 different numbers! The round ends (+15).'],
    [{ type: 'player_left', playerId: 2 }, 'Sam left the match.'],
    [{ type: 'match_completed', winnerIds: [3] }, 'Lee wins the match!'],
    [{ type: 'player_hit', playerId: 1 }, null],
    [{ type: 'something_new' }, null],
  ])('%j', (event, expected) => {
    expect(describeEvent(event, nameOf)).toBe(expected);
  });
});

describe('the table details', () => {
  it('has no activity log', async () => {
    const events = [{ id: 1, type: 'round_started', round: 2, dealerId: 3 }];
    renderRoom(makeRoom(makeGame({ events })));
    await screen.findByLabelText('Game table');
    expect(screen.queryByRole('list', { name: 'What just happened' })).toBeNull();
    expect(screen.queryByText('Round 2 begins. Lee is the dealer.')).toBeNull();
  });

  it("shows the card that caused a bust in that player's row, next to their other cards", async () => {
    const game = makeGame({ players: [seat(1), seat(2, { status: 'busted', numbers: [5, 9], bustCard: 9 }), seat(3)] });
    renderRoom(makeRoom(game));
    await screen.findByLabelText('Game table');
    const row = within(screen.getByRole('list', { name: 'Players' })).getAllByRole('listitem')[1];
    const cards = within(within(row).getByLabelText(/^Cards of /)).getAllByRole('img');
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Card 5', 'Card 9', 'Card 9, the duplicate that caused the bust']);
  });

  it('a duplicate saved by Second Chance stays in the row, marked as saved', async () => {
    const game = makeGame({ players: [seat(1), seat(2, { numbers: [5, 9, 5], savedIndexes: [2], roundScore: 19 }), seat(3)] });
    renderRoom(makeRoom(game));
    await screen.findByLabelText('Game table');
    const row = within(screen.getByRole('list', { name: 'Players' })).getAllByRole('listitem')[1];
    const cards = within(within(row).getByLabelText(/^Cards of /)).getAllByRole('img');
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Card 5', 'Card 9', 'Card 5, a duplicate saved by Second Chance']);
    expect(cards[2].className).toContain('seat__card--saved');
    expect(within(row).queryByText('Bust!')).toBeNull();
  });

  it('crowns the player with the most points', async () => {
    renderRoom(makeRoom(makeGame())); // totals 40 / 25 / 60
    await screen.findByLabelText('Game table');
    const seats = within(screen.getByRole('list', { name: 'Players' })).getAllByRole('listitem');
    expect(seats.map((s) => Boolean(within(s).queryByText('Leader')))).toEqual([false, false, true]);
  });

  it('crowns nobody while everyone is on 0 points', async () => {
    renderRoom(makeRoom(makeGame({ players: [seat(1), seat(2), seat(3)] })));
    await screen.findByLabelText('Game table');
    const seats = within(screen.getByRole('list', { name: 'Players' })).getAllByRole('listitem');
    expect(seats.some((s) => within(s).queryByText('Leader'))).toBe(false);
  });
});
