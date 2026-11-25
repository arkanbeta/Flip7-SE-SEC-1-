import { withTransaction } from '../db/transaction.js';

const RETRIES = 3;
const toDate = (ms) => new Date(ms);

// Saves finished matches. Called ONCE per match by the game manager (its `reported` flag is
// the in-memory "finalized" guard); the database transaction makes the save all-or-nothing:
// the MatchHistories row, every MatchPlayers row and every player's new total_points are
// written together or not at all.
//
// Owner decisions (doc 01):
//  - every player who took part gets a row, leavers included (a leaver has 0 / 0)
//  - ranking_points = final_points for finishers
//  - nobody left at the end -> 'Abandoned': one history row, no player rows, no points
export function createMatchService({ pool, logger = console, retryDelayMs = 200 }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function attempt(work) {
    let lastError;
    for (let i = 1; i <= RETRIES; i += 1) {
      try {
        return await work();
      } catch (error) {
        lastError = error;
        logger.error(`Saving a match failed (attempt ${i}/${RETRIES}):`, error);
        if (i < RETRIES) await sleep(retryDelayMs * i);
      }
    }
    throw lastError;
  }

  // result: the engine's result { rounds, standings:[{userId,finalPoints,rankingPoints,hits,busts,left}] }
  function saveCompleted({ gameModeId, startedAt, finishedAt, result }) {
    return attempt(() =>
      withTransaction(pool, async (conn) => {
        const [match] = await conn.query(
          `INSERT INTO MatchHistories (game_mode_id, started_at, finished_at, number_of_rounds, status)
           VALUES (?, ?, ?, ?, 'Completed')`,
          [gameModeId, toDate(startedAt), toDate(finishedAt), result.rounds]
        );
        for (const s of result.standings) {
          await conn.query(
            `INSERT INTO MatchPlayers (match_id, user_id, final_points, ranking_points, hits, busts)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [match.insertId, s.userId, s.finalPoints, s.rankingPoints, s.hits, s.busts]
          );
          if (s.rankingPoints > 0) {
            await conn.query('UPDATE Users SET total_points = total_points + ? WHERE user_id = ?', [s.rankingPoints, s.userId]);
          }
        }
        return match.insertId;
      })
    );
  }

  function saveAbandoned({ gameModeId, startedAt, finishedAt, rounds }) {
    return attempt(async () => {
      const [match] = await pool.query(
        `INSERT INTO MatchHistories (game_mode_id, started_at, finished_at, number_of_rounds, status)
         VALUES (?, ?, ?, ?, 'Abandoned')`,
        [gameModeId, toDate(startedAt), toDate(finishedAt), rounds]
      );
      return match.insertId;
    });
  }

  return { saveCompleted, saveAbandoned };
}
