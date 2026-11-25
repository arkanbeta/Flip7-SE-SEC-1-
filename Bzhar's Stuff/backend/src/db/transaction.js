// Runs `work` inside a database transaction.
//
//   const result = await withTransaction(pool, async (conn) => {
//     await conn.query('INSERT ...', [...]);
//     await conn.query('UPDATE ...', [...]);
//     return something;
//   });
//
// - If `work` finishes normally, the transaction is COMMITTED.
// - If `work` throws, everything is ROLLED BACK and the error is re-thrown.
// - The connection is always returned to the pool.
//
// Use it whenever several writes must succeed or fail together, for example
// saving a finished match AND adding ranking points (Phase 7).
export async function withTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      // Keep the ORIGINAL error as the one that propagates.
      console.error('Rollback failed:', rollbackError);
    }
    throw error;
  } finally {
    connection.release();
  }
}
