// Decorative artwork for the playing cards. Pure presentation: inline SVG drawn with
// `currentColor`, so each card's accent colour comes from CSS. Every piece is aria-hidden;
// the card itself carries the accessible name.

// The flowing ribbon behind a Number card's value (the "design on the background").
export function Ornament() {
  return (
    <svg className="card-art card-art--ornament" viewBox="0 0 50 70" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M-4 18 C 10 6, 18 30, 30 20 S 46 8, 56 16" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.55" />
      <path d="M-4 52 C 8 62, 20 40, 32 50 S 46 62, 56 54" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.55" />
      <path d="M8 -2 C 2 14, 20 22, 12 36 S 2 58, 10 72" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
      <path d="M42 -2 C 48 14, 30 22, 38 36 S 48 58, 40 72" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
      <circle cx="25" cy="35" r="15" fill="currentColor" opacity="0.10" />
      <circle cx="25" cy="35" r="17.5" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
    </svg>
  );
}

export function Snowflake() {
  const arm = 'M0 -13 V13 M-3.6 -9.5 L0 -6.5 L3.6 -9.5 M-3.6 9.5 L0 6.5 L3.6 9.5';
  return (
    <svg className="card-art card-art--icon" viewBox="-16 -16 32 32" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={arm} />
        <path d={arm} transform="rotate(60)" />
        <path d={arm} transform="rotate(120)" />
      </g>
      <circle r="2.1" fill="currentColor" />
    </svg>
  );
}

export function Heart() {
  return (
    <svg className="card-art card-art--icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 27 C 6 20, 3 14, 3 10 a 6.5 6.5 0 0 1 13 -1.5 A 6.5 6.5 0 0 1 29 10 c 0 4 -3 10 -13 17 z" fill="currentColor" />
      <path d="M8.5 9.5 a 3.4 3.4 0 0 1 4 -2.4" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// Flip Three: three fanned cards with a "3", motion marks and little sparkles.
export function FanOfThree() {
  return (
    <svg className="card-art card-art--icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
        <rect x="9" y="6" width="12" height="17" rx="2.2" transform="rotate(-20 15 23)" fill="#FBF7EC" opacity="0.9" />
        <rect x="11" y="6" width="12" height="17" rx="2.2" transform="rotate(20 17 23)" fill="#FBF7EC" opacity="0.9" />
        <rect x="10" y="7" width="12" height="17" rx="2.2" fill="#FBF7EC" />
        <rect x="10" y="7" width="12" height="17" rx="2.2" fill="currentColor" fillOpacity="0.16" />
        <rect x="11.6" y="8.6" width="8.8" height="13.8" rx="1.3" fill="none" strokeWidth="0.5" opacity="0.6" />
      </g>
      <text x="16" y="20.4" textAnchor="middle" fontSize="10.5" fontWeight="800" fill="currentColor" fontFamily="Fraunces Variable, Georgia, serif">3</text>
      {/* motion marks: the cards are flying out */}
      <g fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.7">
        <path d="M3.2 11.5 Q 1.8 15, 3 18.5" />
        <path d="M28.8 11.5 Q 30.2 15, 29 18.5" />
      </g>
      <path d="M16 0.6 l0.9 2 2 0.9 -2 0.9 -0.9 2 -0.9 -2 -2 -0.9 2 -0.9 z" fill="currentColor" opacity="0.85" />
      <path d="M5 3.5 l0.5 1.1 1.1 0.5 -1.1 0.5 -0.5 1.1 -0.5 -1.1 -1.1 -0.5 1.1 -0.5 z" fill="currentColor" opacity="0.6" />
      <path d="M27 3.5 l0.5 1.1 1.1 0.5 -1.1 0.5 -0.5 1.1 -0.5 -1.1 -1.1 -0.5 1.1 -0.5 z" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

// Background shared by every Action card (Freeze, Flip Three, Second Chance) so they read as
// one family that stands apart from Number cards: a sunburst of rays and two rings around the
// icon, plus three pips top and bottom. `lifted`: a caption sits under the icon, so the burst
// is centred higher, on the icon, and the rings stay clear of the caption.
export function ActionBurst({ lifted = false }) {
  const rays = Array.from({ length: 24 }, (_, i) => i * 15);
  const pips = [20, 25, 30];
  return (
    <svg className="card-art card-art--ornament" viewBox="0 0 50 70" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g transform={`translate(25 ${lifted ? 27.5 : 35})`}>
        {rays.map((deg, i) => (
          <path key={deg} d="M-1.6 -11 L0 -42 L1.6 -11 Z" transform={`rotate(${deg})`} fill="currentColor" opacity={i % 2 ? 0.05 : 0.1} />
        ))}
        <circle r="13" fill="currentColor" opacity="0.08" />
        <circle r="15.5" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="0.6 1.6" strokeLinecap="round" opacity="0.6" />
        <circle r="11.5" fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.35" />
      </g>
      <g className="card-art__pips" fill="currentColor" opacity="0.55">
        {pips.map((x) => (
          <g key={x}>
            <path d={`M${x} 6.5 l1.6 1.6 -1.6 1.6 -1.6 -1.6 z`} />
            <path d={`M${x} 60.3 l1.6 1.6 -1.6 1.6 -1.6 -1.6 z`} />
          </g>
        ))}
      </g>
    </svg>
  );
}

// Card back: lattice, inner frame and a large "7" monogram (like the reference's "M").
export function CardBack() {
  return (
    <svg className="card-art card-art--back" viewBox="0 0 50 70" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="flip7-lattice" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0 H6 M0 0 V6" stroke="#FBF7EC" strokeOpacity="0.08" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width="50" height="70" fill="url(#flip7-lattice)" />
      <rect x="4" y="4" width="42" height="62" rx="4" fill="none" stroke="#FBF7EC" strokeOpacity="0.55" strokeWidth="0.7" />
      <text x="25" y="47" textAnchor="middle" fontSize="34" fontWeight="700" fill="#FBF7EC" fillOpacity="0.2" fontFamily="Fraunces Variable, Georgia, serif">7</text>
      <text x="25" y="38.5" textAnchor="middle" fontSize="5.2" letterSpacing="0.8" fontWeight="600" fill="#FBF7EC" fillOpacity="0.88" fontFamily="Nunito Variable, sans-serif">FLIP 7</text>
    </svg>
  );
}
