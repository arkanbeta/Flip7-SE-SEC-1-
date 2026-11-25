import Button from './Button.jsx';
import './FullPageMessage.css';

// Centered message used while the app is loading or cannot reach the server.
export function LoadingScreen() {
  return (
    <main className="full-page-message" role="status" aria-live="polite">
      <span className="full-page-message__spinner" aria-hidden="true" />
      <p>Loading...</p>
    </main>
  );
}

export function ConnectionError({ onRetry }) {
  return (
    <main className="full-page-message" role="alert">
      <h1>Can&rsquo;t reach the server</h1>
      <p>Check your internet connection and try again.</p>
      <Button onClick={onRetry}>Try again</Button>
    </main>
  );
}
