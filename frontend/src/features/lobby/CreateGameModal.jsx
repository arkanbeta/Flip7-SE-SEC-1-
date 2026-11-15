import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../../components/Modal.jsx';
import Button from '../../components/Button.jsx';
import { createRoom, getRoomModes } from '../../services/api.js';
import { roomErrorMessage } from './roomMessages.js';
import './RoomForms.css';

const CAPACITIES = [3, 4, 5, 6, 7]; // same limits as the backend (utils/roomRules.js)

export default function CreateGameModal({ open, onClose }) {
  const navigate = useNavigate();
  const [modes, setModes] = useState([]);
  const [modeId, setModeId] = useState(null);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setError('');
    setLoadError('');
    getRoomModes()
      .then(({ modes: list }) => {
        if (cancelled) return;
        setModes(list);
        setModeId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((e) => !cancelled && setLoadError(roomErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy || modeId == null) return;
    setBusy(true);
    setError('');
    try {
      const { room } = await createRoom({ gameModeId: modeId, maxPlayers });
      onClose();
      navigate(`/rooms/${room.code}`);
    } catch (e) {
      if (e.code === 'ALREADY_IN_OTHER_ROOM' && e.details?.code) {
        onClose();
        navigate(`/rooms/${e.details.code}`);
        return;
      }
      setError(roomErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a game">
      <form onSubmit={handleSubmit} noValidate>
        {/* A choice with one option is not a choice: the picker only appears once there are more modes. */}
        {modes.length > 1 && (
          <fieldset className="choice">
            <legend>Game mode</legend>
            {modes.map((mode) => (
              <label key={mode.id} className="choice__option">
                <input type="radio" name="mode" checked={modeId === mode.id} onChange={() => setModeId(mode.id)} />
                <span>{mode.name}</span>
              </label>
            ))}
          </fieldset>
        )}

        <fieldset className="choice">
          <legend>Maximum players</legend>
          <div className="choice__row">
            {CAPACITIES.map((n) => (
              <label key={n} className="choice__chip">
                <input type="radio" name="capacity" checked={maxPlayers === n} onChange={() => setMaxPlayers(n)} />
                <span>{n}</span>
              </label>
            ))}
          </div>
          <p className="choice__hint">A game needs at least 3 players.</p>
        </fieldset>

        {(loadError || error) && (
          <p className="form-error" role="alert">
            {loadError || error}
          </p>
        )}
        <div className="modal__actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={modeId == null}>
            Create room
          </Button>
        </div>
      </form>
    </Modal>
  );
}
