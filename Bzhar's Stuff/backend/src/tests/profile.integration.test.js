// Profile, statistics and match-history endpoints against a REAL database.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createHarness, integrationEnabled } from './integrationHarness.js';

describe.skipIf(!integrationEnabled)('profile endpoints (integration)', () => {
  let h;
  beforeAll(() => {
    h = createHarness();
  });
  afterAll(async () => {
    await h.cleanup();
  });

  describe('access control', () => {
    it('GET /users/me and /users/me/matches need a signed-in user (401)', async () => {
      for (const path of ['/api/users/me', '/api/users/me/matches']) {
        const res = await request(h.app).get(path);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('AUTH_REQUIRED');
      }
    });

    it('PATCH /users/me is refused for visitors and without a CSRF token', async () => {
      expect((await request(h.app).patch('/api/users/me').send({ avatar: 'owl' })).status).toBe(403);
      const { agent } = await h.createSignedInUser();
      const res = await agent.patch('/api/users/me').send({ avatar: 'owl' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_INVALID');
    });

    it('a pending (not yet registered) Google sign-in cannot read profiles', async () => {
      const agent = request.agent(h.app);
      await agent.get('/api/auth/google');
      expect((await agent.get('/api/users/me')).status).toBe(401);
    });
  });

  describe('GET /api/users/me (profile + statistics)', () => {
    it('returns zeros for a brand-new player', async () => {
      const { agent, user } = await h.createSignedInUser();
      const res = await agent.get('/api/users/me');
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ id: user.id, nickname: user.nickname, totalPoints: 0 });
      expect(res.body.user).not.toHaveProperty('google_id');
      expect(res.body.stats).toEqual({ matchesPlayed: 0, totalHits: 0, totalBusts: 0 });
    });

    it("derives matches, hits and busts from the player's own MatchPlayers rows only", async () => {
      const a = await h.createSignedInUser();
      const b = await h.createSignedInUser();
      const base = Date.now() - 86_400_000;
      await h.seedMatch({ finishedAt: new Date(base), players: [
        { userId: a.user.id, finalPoints: 120, rankingPoints: 10, hits: 7, busts: 1 },
        { userId: b.user.id, finalPoints: 80, rankingPoints: 5, hits: 4, busts: 2 },
      ] });
      await h.seedMatch({ finishedAt: new Date(base + 1000), players: [
        { userId: a.user.id, finalPoints: -5, rankingPoints: 0, hits: 3, busts: 4 },
        { userId: b.user.id, finalPoints: 200, rankingPoints: 12, hits: 9, busts: 0 },
      ] });
      await h.pool.query('UPDATE Users SET total_points = 10 WHERE user_id = ?', [a.user.id]);

      const resA = await a.agent.get('/api/users/me');
      expect(resA.body.stats).toEqual({ matchesPlayed: 2, totalHits: 10, totalBusts: 5 });
      expect(resA.body.user.totalPoints).toBe(10);
      expect((await b.agent.get('/api/users/me')).body.stats).toEqual({ matchesPlayed: 2, totalHits: 13, totalBusts: 2 });
    });
  });

  describe('GET /api/users/me/matches', () => {
    it('lists newest first with mode, points, hits, busts and rounds', async () => {
      const a = await h.createSignedInUser();
      const t = Date.now() - 3_600_000;
      const m1 = await h.seedMatch({ finishedAt: new Date(t), rounds: 4, players: [{ userId: a.user.id, finalPoints: 50, rankingPoints: 3, hits: 5, busts: 1 }] });
      const m2 = await h.seedMatch({ finishedAt: new Date(t + 60_000), rounds: 6, players: [{ userId: a.user.id, finalPoints: 90, rankingPoints: 8, hits: 8, busts: 0 }] });
      const res = await a.agent.get('/api/users/me/matches');
      expect(res.body.matches.map((m) => m.matchId)).toEqual([m2, m1]);
      expect(res.body.matches[0]).toEqual({
        matchId: m2, gameMode: 'Normal', finishedAt: new Date(t + 60_000).toISOString(),
        numberOfRounds: 6, finalPoints: 90, rankingPoints: 8, hits: 8, busts: 0,
      });
    });

    it("is empty for a player with no matches and never shows other players' matches", async () => {
      const a = await h.createSignedInUser();
      const b = await h.createSignedInUser();
      await h.seedMatch({ finishedAt: new Date(), players: [{ userId: b.user.id, finalPoints: 1, rankingPoints: 1, hits: 1, busts: 0 }] });
      expect((await a.agent.get('/api/users/me/matches')).body.matches).toEqual([]);
    });

    it('respects ?limit and rejects invalid limits', async () => {
      const a = await h.createSignedInUser();
      const t = Date.now() - 7_200_000;
      for (let i = 0; i < 3; i += 1) {
        await h.seedMatch({ finishedAt: new Date(t + i * 1000), players: [{ userId: a.user.id, finalPoints: i, rankingPoints: 0, hits: 0, busts: 0 }] });
      }
      expect((await a.agent.get('/api/users/me/matches?limit=2')).body.matches).toHaveLength(2);
      for (const bad of ['0', '51', 'abc', '-3', '5;DROP']) {
        const res = await a.agent.get(`/api/users/me/matches?limit=${encodeURIComponent(bad)}`);
        expect(res.status).toBe(400);
        expect(res.body.error.details.field).toBe('limit');
      }
    });

    it('keeps negative final points', async () => {
      const a = await h.createSignedInUser();
      await h.seedMatch({ finishedAt: new Date(), players: [{ userId: a.user.id, finalPoints: -15, rankingPoints: 0, hits: 1, busts: 3 }] });
      expect((await a.agent.get('/api/users/me/matches')).body.matches[0].finalPoints).toBe(-15);
    });
  });

  describe('PATCH /api/users/me', () => {
    const patch = ({ agent, csrfToken }, body) => agent.patch('/api/users/me').set('X-CSRF-Token', csrfToken).send(body);

    it('changes the nickname and it shows everywhere', async () => {
      const a = await h.createSignedInUser();
      const nickname = h.uniqueNickname();
      const res = await patch(a, { nickname });
      expect(res.status).toBe(200);
      expect(res.body.user.nickname).toBe(nickname);
      expect((await a.agent.get('/api/auth/me')).body.user.nickname).toBe(nickname);
    });

    it('changes the avatar, or both at once', async () => {
      const a = await h.createSignedInUser({ avatar: 'fox' });
      expect((await patch(a, { avatar: 'panda' })).body.user.avatar).toBe('panda');
      const nickname = h.uniqueNickname();
      expect((await patch(a, { nickname, avatar: 'lion' })).body.user).toMatchObject({ nickname, avatar: 'lion' });
    });

    it("rejects someone else's nickname (409), including case/accent variants, and keeps the old one", async () => {
      const a = await h.createSignedInUser({ nickname: `Zoé${Date.now() % 1e5}` });
      const b = await h.createSignedInUser();
      for (const nickname of [a.user.nickname, a.user.nickname.toUpperCase(), a.user.nickname.replace('é', 'e')]) {
        const res = await patch(b, { nickname });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('NICKNAME_TAKEN');
      }
      expect((await b.agent.get('/api/users/me')).body.user.nickname).toBe(b.user.nickname);
    });

    it('lets a player change the capitalisation of, or re-save, their OWN nickname', async () => {
      const a = await h.createSignedInUser({ nickname: `lowercase${Date.now() % 1e5}` });
      expect((await patch(a, { nickname: a.user.nickname })).status).toBe(200);
      const res = await patch(a, { nickname: a.user.nickname.toUpperCase() });
      expect(res.status).toBe(200);
      expect(res.body.user.nickname).toBe(a.user.nickname.toUpperCase());
    });

    it.each([
      [{ nickname: 'a b' }, 'nickname'],
      [{ nickname: 'x' }, 'nickname'],
      [{ avatar: 'not-an-avatar' }, 'avatar'],
      [{}, 'body'],
    ])('rejects invalid update %j', async (body, field) => {
      const a = await h.createSignedInUser();
      const res = await patch(a, body);
      expect(res.status).toBe(400);
      expect(res.body.error.details.field).toBe(field);
    });

    it('cannot change the email, points, or any other column', async () => {
      const a = await h.createSignedInUser();
      for (const body of [{ email: 'hacker@example.test' }, { totalPoints: 999999 }, { total_points: 999999 }, { user_id: 1 }, { google_id: 'x' }]) {
        expect((await patch(a, { ...body, nickname: h.uniqueNickname() })).status).toBe(400);
      }
      const me = (await a.agent.get('/api/users/me')).body.user;
      expect(me.email).toBe(a.user.email);
      expect(me.totalPoints).toBe(0);
    });

    it('has no route that edits another player by id', async () => {
      const a = await h.createSignedInUser();
      const b = await h.createSignedInUser();
      const res = await b.agent.patch(`/api/users/${a.user.id}`).set('X-CSRF-Token', b.csrfToken).send({ avatar: 'owl' });
      expect(res.status).toBe(404);
      expect((await a.agent.get('/api/users/me')).body.user.avatar).toBe(a.user.avatar);
    });
  });
});
