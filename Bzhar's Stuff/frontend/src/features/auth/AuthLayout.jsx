import './auth.css';

// Shared frame for the login / create-account pages: brand on the left, form card on the right.
export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="auth-layout">
      <section className="auth-brand">
        <p className="auth-brand__name">Flip 7 Online</p>
        <p className="auth-brand__tagline">Play Flip 7 with friends in private rooms, in real time.</p>

        {/* Decorative card that flips over once when the page opens (pure CSS 3D transform). */}
        <div className="hero-card" aria-hidden="true">
          <div className="hero-card__inner">
            <div className="hero-card__face hero-card__face--back" />
            <div className="hero-card__face hero-card__face--front">
              <span className="hero-card__corner">7</span>
              <span className="hero-card__value">7</span>
              <span className="hero-card__corner hero-card__corner--end">7</span>
            </div>
          </div>
        </div>
      </section>

      <main className="auth-panel">
        <div className="auth-card">
          <h1>{title}</h1>
          {subtitle && <p className="auth-card__subtitle">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
