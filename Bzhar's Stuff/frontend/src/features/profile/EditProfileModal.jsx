import { useEffect, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import Button from '../../components/Button.jsx';
import TextField from '../../components/TextField.jsx';
import AvatarPicker from '../../components/AvatarPicker.jsx';
import { checkNickname, updateProfile, ApiError } from '../../services/api.js';
import { isValidNickname, NICKNAME_RULE } from '../auth/authMessages.js';

const ERRORS = {
  NICKNAME_TAKEN: 'That nickname is already taken. Please choose another.',
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
  NETWORK_ERROR: 'Cannot reach the server. Check your connection.',
};

export default function EditProfileModal({ open, onClose, user, onSaved }) {
  return (
    <Modal open={open} onClose={onClose} title="Edit profile">
      {/* Mounted only while open, so the form always starts from the current values. */}
      <EditForm user={user} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

function EditForm({ user, onClose, onSaved }) {
  const [nickname, setNickname] = useState(user.nickname);
  const [avatar, setAvatar] = useState(user.avatar);
  const [availability, setAvailability] = useState('idle'); // idle | checking | available | taken | unknown
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const trimmed = nickname.trim();
  const formatOk = isValidNickname(trimmed);
  const nicknameChanged = trimmed !== user.nickname;
  const avatarChanged = avatar !== user.avatar;

  // Convenience only: the database guarantees uniqueness when saving.
  useEffect(() => {
    if (!nicknameChanged || !formatOk) {
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
        if (!cancelled) setAvailability('unknown');
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, formatOk, nicknameChanged]);

  const canSave = formatOk && (nicknameChanged || avatarChanged) && availability !== 'taken' && !saving;

  const hint = (() => {
    if (!formatOk) return { tone: 'error', text: NICKNAME_RULE };
    if (availability === 'checking') return { tone: 'neutral', text: 'Checking availability...' };
    if (availability === 'available') return { tone: 'success', text: 'Nickname is available.' };
    if (availability === 'taken') return { tone: 'error', text: ERRORS.NICKNAME_TAKEN };
    return { tone: 'neutral', text: NICKNAME_RULE };
  })();

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    // Send only what actually changed.
    const changes = {};
    if (nicknameChanged) changes.nickname = trimmed;
    if (avatarChanged) changes.avatar = avatar;
    try {
      const { user: updated } = await updateProfile(changes);
      onSaved(updated);
      onClose();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      if (code === 'NICKNAME_TAKEN') setAvailability('taken');
      setError(ERRORS[code] ?? (code === 'VALIDATION_ERROR' ? err.message : 'Something went wrong. Please try again.'));
      setSaving(false);
    }
  }

  return (
    <form className="edit-profile" onSubmit={handleSubmit} noValidate>
      <TextField
        label="Nickname"
        value={nickname}
        onChange={(event) => setNickname(event.target.value)}
        maxLength={20}
        autoComplete="off"
        spellCheck={false}
        hint={hint}
      />
      <p className="edit-profile__email">
        Email: <strong>{user.email}</strong> <span>(comes from your Google account and can&rsquo;t be changed)</span>
      </p>
      <AvatarPicker value={avatar} onChange={setAvatar} legend="Avatar" />
      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave} loading={saving}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
