import { formatNumber } from '../../utils/format.js';

// Four headline numbers. They are DISPLAYED as received from the backend (which derives
// them from the stored match records); nothing is computed here.
export default function StatsGrid({ totalPoints, stats }) {
  const items = [
    { label: 'Ranking points', value: totalPoints, accent: true },
    { label: 'Matches played', value: stats.matchesPlayed },
    { label: 'Total hits', value: stats.totalHits },
    { label: 'Total busts', value: stats.totalBusts },
  ];
  return (
    <dl className="stats-grid">
      {items.map((item) => (
        <div key={item.label} className={`stat${item.accent ? ' stat--accent' : ''}`}>
          <dd className="stat__value">{formatNumber(item.value)}</dd>
          <dt className="stat__label">{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}
