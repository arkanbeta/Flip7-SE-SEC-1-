// Small display helpers. They only format values; they never compute game results.
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// ISO timestamps from the backend are UTC; Intl shows them in the viewer's local time.
export function formatDateTime(isoString) {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
}

const numberFormatter = new Intl.NumberFormat();
export const formatNumber = (value) => numberFormatter.format(value);

// Adds an explicit + for positive numbers ("+12"); zero and negatives are left alone.
export const formatSigned = (value) => (value > 0 ? `+${numberFormatter.format(value)}` : numberFormatter.format(value));
