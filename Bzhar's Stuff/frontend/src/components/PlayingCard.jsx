import { ActionBurst, CardBack, FanOfThree, Heart, Ornament, Snowflake } from './cardArt.jsx';
import './PlayingCard.css';

// A reusable playing card with a front and a back. The flip is a CSS 3D transform:
// the card is two faces on a turning "inner" element, and `faceUp` decides which one shows.
// It only DISPLAYS what it is told; it knows nothing about game rules.
//
//   faceUp   true = front visible, false = back visible
//   label    the text/number on the front (the game feature decides what it is)
//   kind     'number' (default) | 'modifier' | 'freeze' | 'flip_three' | 'second_chance':
//            only changes the artwork (special cards get their own icon and colour)
//   caption  optional small text under a special card's icon (e.g. "2nd Chance")
//   state    'default' | 'selected' | 'disabled' | 'danger'
//   deal     true = the card flips and slides in when it first appears (hands on the table)
//   size     'xs' | 'sm' | 'md' | 'lg' (card width follows the size and scales with the screen)
//   onClick  makes the card a real <button> (keyboard-accessible); omit for a static card
const ICONS = { freeze: Snowflake, second_chance: Heart, flip_three: FanOfThree };

export default function PlayingCard({
  faceUp = true,
  label,
  kind = 'number',
  caption,
  state = 'default',
  deal = false,
  size = 'md',
  onClick,
  ariaLabel,
  className = '',
}) {
  // Each Number value gets its own accent (0-12 cycle through the earthy palette).
  const tone = kind === 'number' && /^\d+$/.test(String(label)) ? Number(label) % 6 : null;
  const classes = [
    'playing-card',
    `playing-card--${size}`,
    `playing-card--${state}`,
    `playing-card--kind-${kind}`,
    tone !== null && `playing-card--tone-${tone}`,
    faceUp && 'is-face-up',
    deal && 'playing-card--deal',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const description = ariaLabel ?? (faceUp ? `Card ${label}` : 'Face-down card');
  const Icon = ICONS[kind];

  const faces = (
    <span className="playing-card__inner">
      {/* Corner indices are drawn by CSS from data-label, so the label appears in the text once. */}
      <span className="playing-card__face playing-card__face--front" data-label={kind === 'flip_three' ? '+3' : Icon ? '' : label} aria-hidden={!faceUp}>
        <span className="playing-card__frame" />
        {kind === 'number' && <Ornament />}
        {Icon && <ActionBurst lifted={Boolean(caption)} />}
        {Icon ? (
          <span className="playing-card__special">
            <Icon />
            {caption && <span className="playing-card__caption">{caption}</span>}
          </span>
        ) : (
          <span className="playing-card__value">{label}</span>
        )}
      </span>
      <span className="playing-card__face playing-card__face--back" aria-hidden={faceUp}>
        <CardBack />
      </span>
    </span>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} disabled={state === 'disabled'} aria-label={description}>
        {faces}
      </button>
    );
  }
  return (
    <span className={classes} role="img" aria-label={description}>
      {faces}
    </span>
  );
}
