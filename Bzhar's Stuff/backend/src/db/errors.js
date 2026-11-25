// MySQL reports a violated UNIQUE constraint as error code ER_DUP_ENTRY, with a
// message such as:  Duplicate entry 'x' for key 'Users.nickname'
// This returns the column/index name ('nickname'), 'unknown' if it cannot be
// parsed, or null when the error is not a duplicate-key error at all.
export function getDuplicateKey(error) {
  if (error?.code !== 'ER_DUP_ENTRY') return null;
  const match = /for key '([^']+)'/.exec(error.sqlMessage ?? '');
  return match ? match[1].split('.').pop() : 'unknown';
}
