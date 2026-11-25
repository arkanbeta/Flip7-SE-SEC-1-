import { useId } from 'react';
import './TextField.css';

// A labelled input with an optional hint underneath.
// hint: { tone: 'neutral' | 'success' | 'error', text }. tone 'error' also marks the input invalid.
export default function TextField({ label, hint, className = '', ...inputProps }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={hint?.tone === 'error' || undefined}
        aria-describedby={hint ? hintId : undefined}
        {...inputProps}
      />
      {hint && (
        <p id={hintId} className={`field__hint field__hint--${hint.tone}`}>
          {hint.text}
        </p>
      )}
    </div>
  );
}
