import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Modal from '../../components/Modal.jsx';
import Button from '../../components/Button.jsx';
import TextField from '../../components/TextField.jsx';
import { joinRoom } from '../../services/api.js';
import { normalizeRoomCode, isValidRoomCode, ROOM_CODE_RULE } from '../../utils/roomCode.js';
import { roomErrorMessage } from './roomMessages.js';
import './RoomForms.css';

export default function JoinGameModal({ open, onClose }) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null); // the ApiError, so we can link to the other room
  const [busy, setBusy] = useState(false);

  const valid = isValidRoomCode(code);
  const hint = error
    ? { tone: 'error', text: roomErrorMessage(error) }
    : { tone: code && !valid ? 'error' : 'neutral', text: ROOM_CODE_RULE };

  async function handleSubmit(event) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { room } = await joinRoom(code);
      handleClose();
      navigate(`/rooms/${room.code}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    setCode('');
    setError(null);
    onClose();
  }

  const otherRoom = error?.code === 'ALREADY_IN_OTHER_ROOM' ? error.details?.code : null;

  return (
    <Modal open={open} onClose={handleClose} title="Join a game">
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          className="field--code"
          label="Room code"
          value={code}
          onChange={(event) => {
            setCode(normalizeRoomCode(event.target.value));
            setError(null);
          }}
          hint={hint}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
        />
        {otherRoom && (
          <p className="form-note">
            <Link to={`/rooms/${otherRoom}`} onClick={handleClose}>
              Go back to your room ({otherRoom})
            </Link>
          </p>
        )}
        <div className="modal__actions">
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!valid}>
            Join
          </Button>
        </div>
      </form>
    </Modal>
  );
}
