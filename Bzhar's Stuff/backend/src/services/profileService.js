// Statistics and match history, DERIVED from MatchPlayers/MatchHistories at request time.
// Nothing is stored redundantly, so the numbers can never drift out of sync.
// (Abandoned matches have no MatchPlayers rows, so they never appear here.)
export function createProfileService(pool) {
  async function getStats(userId) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS matches_played,
              COALESCE(SUM(hits), 0) AS total_hits,
              COALESCE(SUM(busts), 0) AS total_busts
         FROM MatchPlayers WHERE user_id = ?`,
      [userId]
    );
    const row = rows[0];
    // SUM() comes back as a DECIMAL string, hence Number().
    return {
      matchesPlayed: Number(row.matches_played),
      totalHits: Number(row.total_hits),
      totalBusts: Number(row.total_busts),
    };
  }

  async function getRecentMatches(userId, limit) {
    const [rows] = await pool.query(
      `SELECT mp.match_id, mp.final_points, mp.ranking_points, mp.hits, mp.busts,
              mh.finished_at, mh.number_of_rounds, gm.name AS game_mode
         FROM MatchPlayers mp
         JOIN MatchHistories mh ON mh.match_id = mp.match_id
         JOIN GameModes gm ON gm.game_mode_id = mh.game_mode_id
        WHERE mp.user_id = ?
        ORDER BY mh.finished_at DESC, mp.match_id DESC
        LIMIT ?`,
      [userId, limit]
    );
    return rows.map((row) => ({
      matchId: row.match_id,
      gameMode: row.game_mode,
      finishedAt: row.finished_at,
      numberOfRounds: row.number_of_rounds,
      finalPoints: row.final_points,
      rankingPoints: row.ranking_points,
      hits: row.hits,
      busts: row.busts,
    }));
  }

  return { getStats, getRecentMatches };
}
