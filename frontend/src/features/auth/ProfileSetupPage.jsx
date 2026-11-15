import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { checkNickname, ApiError } from '../../services/api.js';
import Button from '../../components/Button.jsx';
import { LoadingScreen, ConnectionError } from '../../components/FullPageMessage.jsx';
import AuthLayout from './AuthLayout.jsx';
import AvatarPicker from '../../components/AvatarPicker.jsx';
import { isValidNickname, NICKNAME_RULE } from './authMessages.js';

const SUBMIT_ERRORS = {
  NICKNAME_TAKEN: 'That nickname is already taken. Please choose another.',
  EMAIL_IN_USE: 'This email address already belongs to another Flip 7 account.',
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
};
// Codes that mean "this sign-in is no longer valid": the person must start over.
const SESSION_LOST = new Set(['NO_PENDING_REGISTRATION', 'CSRF_INVALID', 'AUTH_REQUIRED']);

// Step 2 of account creation (shown after Google confirmed who the person is).
export default function ProfileSetupPage() {
  const { status, user, pendingProfile, register, refresh } = useAuth();
  const [params] = useSearchParams();

  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [availability, setAvailability] = useState('idle'); // idle | checking | available | taken | unknown
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [sessionLost, setSessionLost] = useState(false);

  const trimmed = nickname.trim();
  const formatOk = isValidNickname(trimmed);

  // As the person types, ask the backend whether the nickname is free (after a short pause).
  // This is only a convenience: the database is what finally guarantees uniqueness.
  useEffect(() => {
    if (!formatOk || status !== 'ready' || !pendingProfile) {
      setAvailability('idle');
      return undefined;
    }
    setAvailability('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await checkNickname(trimmed);
        if (!cancelled) setAvailability(result.available ? 'available' : 'taken');
      } catch {
        if (!cancelled) setAvailability('unknown'); // fine: the real check happens on submit
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, formatOk, status, pendingProfile]);

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'error') return <ConnectionError onRetry={refresh} />;
  if (user) return <Navigate to="/lobby" replace />;
  if (!pendingProfile) return <Navigate to="/create-account" replace />;

  const canSubmit = formatOk && avatar && availability !== 'taken' && !submitting;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await register({ nickname: trimmed, avatar }); // on success the guard above redirects to /lobby
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      if (code === 'NICKNAME_TAKEN') setAvailability('taken');
      if (SESSION_LOST.has(code)) setSessionLost(true);
      setSubmitError(
        SUBMIT_ERRORS[code] ??
          (error instanceof ApiError && code === 'VALIDATION_ERROR' ? error.message : null) ??
          'Something went wrong. Please try again.'
      );
      setSubmitting(false);
    }
  }

  const nicknameHint = (() => {
    if (nickname && !formatOk) return { tone: 'error', text: NICKNAME_RULE };
    if (availability === 'checking') return { tone: 'neutral', text: 'Checking availability...' };
    if (availability === 'available') return { tone: 'success', text: 'Nickname is available.' };
    if (availability === 'taken') return { tone: 'error', text: SUBMIT_ERRORS.NICKNAME_TAKEN };
    return { tone: 'neutral', text: NICKNAME_RULE };
  })();

  return (
    <AuthLayout title="Almost there" subtitle={`Signed in with Google as ${pendingProfile.email}.`}>
      {params.get('from') === 'login' && (
        <p className="form-note">
          We couldn&rsquo;t find an account for this Google address, so let&rsquo;s create one.
        </p>
      )}

      <form className="profile-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="nickname">Nickname</label>
          <input
            id="nickname"
            name="nickname"
            type="text"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={nicknameHint.tone === 'error'}
            aria-describedby="nickname-hint"
          />
          <p id="nickname-hint" className={`field__hint field__hint--${nicknameHint.tone}`}>
            {nicknameHint.text}
          </p>
        </div>

        <AvatarPicker value={avatar} onChange={setAvatar} />

        {submitError && (
          <p className="form-alert" role="alert">
            {submitError}{' '}
            {sessionLost && <Link to="/create-account">Start again</Link>}
          </p>
        )}

        <Button type="submit" disabled={!canSubmit} loading={submitting} aria-describedby="setup-missing">
          Create account
        </Button>
        {/* a greyed-out button should say what it is waiting for */}
        <p id="setup-missing" className="field__hint field__hint--neutral" aria-live="polite">
          {!submitting && (!formatOk ? 'Pick a nickname to continue.' : !avatar ? 'Choose an avatar to continue.' : '')}
        </p>
      </form>
    </AuthLayout>
  );
}
