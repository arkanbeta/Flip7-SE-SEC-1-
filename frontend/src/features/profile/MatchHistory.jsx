import { formatDateTime, formatNumber, formatSigned } from '../../utils/format.js';

// Recent matches, newest first. Each row shows the values stored for that match.
export default function MatchHistory({ matches }) {
  if (matches.length === 0) {
    return <p className="match-empty">No matches yet. Your results will appear here after your first game.</p>;
  }
  return (
    <ul className="match-list">
      {matches.map((match) => (
        <li key={match.matchId} className="match">
          <div className="match__head">
            <span className="match__mode">{match.gameMode}</span>
            <time className="match__date" dateTime={match.finishedAt}>
              {formatDateTime(match.finishedAt)}
            </time>
          </div>
          <dl className="match__numbers">
            <div>
              <dt>Final points</dt>
              <dd>{formatNumber(match.finalPoints)}</dd>
            </div>
            <div>
              <dt>Ranking points</dt>
              <dd className="match__ranking">{formatSigned(match.rankingPoints)}</dd>
            </div>
            <div>
              <dt>Hits</dt>
              <dd>{formatNumber(match.hits)}</dd>
            </div>
            <div>
              <dt>Busts</dt>
              <dd>{formatNumber(match.busts)}</dd>
            </div>
            <div>
              <dt>Rounds</dt>
              <dd>{formatNumber(match.numberOfRounds)}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
