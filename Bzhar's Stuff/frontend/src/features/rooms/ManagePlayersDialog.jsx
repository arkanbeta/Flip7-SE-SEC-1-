import { useEffect, useRef, useState } from 'react';
import Modal from '../../components/Modal.jsx';
import Button from '../../components/Button.jsx';
import Avatar from '../../components/Avatar.jsx';

// Host only. Kick = the player leaves the room (they may come back with the code).
// Ban = they leave and can never join THIS room again. The other player cannot undo either,
// so every removal is asked twice. The server decides who may be kicked (player.canKick).
//   onRemove  async (playerId, ban) => void
export default function ManagePlayersDialog({ open, room, me, busy, error, onClose, onRemove }) {
  const [pending, setPending] = useState(null); // { player, ban }: the removal waiting for a yes
  const bodyRef = useRef(null);
  // The list and the question replace each other: keep the keyboard inside the dialog.
  useEffect(() => bodyRef.current?.querySelector('button:not([disabled])')?.focus(), [pending]);

  const close = () => {
    setPending(null);
    onClose();
  };
  const others = room.players.filter((p) => p.id !== me);
  const matchRunning = Boolean(room.game && room.game.phase !== 'finished');

  if (pending) {
    const { player, ban } = pending;
    const keepsPoints = matchRunning && !player.isSpectator;
    return (
      <Modal open={open} onClose={close} title={`${ban ? 'Ban' : 'Kick'} ${player.nickname}?`}>
        <div ref={bodyRef}>
          <p>
            {ban ? (
              <>
                They leave the room now and <strong>cannot join it again</strong>. This cannot be undone. Other rooms are not affected.
              </>
            ) : (
              'They leave the room now. They can join again with the room code.'
            )}
            {keepsPoints && ' The points they have banked in this match still count.'}
          </p>
          <div className="modal__actions">
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              className="btn--danger"
              loading={busy}
              onClick={async () => {
                await onRemove(player.id, ban);
                setPending(null);
              }}
            >
              {ban ? 'Ban' : 'Kick'} {player.nickname}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  const kickLocked = others.some((p) => !p.canKick);
  return (
    <Modal open={open} onClose={close} title="Manage players">
      <div ref={bodyRef}>
        {others.length === 0 && <p>No other players are here.</p>}
        <ul className="manage__list">
          {others.map((p) => (
            <li key={p.id} className="manage__row">
              <Avatar id={p.avatar} name="" size={36} />
              <span className="manage__name">{p.nickname}</span>
              <Button
                variant="secondary"
                disabled={!p.canKick}
                aria-label={`Kick ${p.nickname}`}
                aria-describedby={p.canKick ? undefined : 'kick-locked'}
                onClick={() => setPending({ player: p, ban: false })}
              >
                Kick
              </Button>
              <Button variant="secondary" aria-label={`Ban ${p.nickname}`} onClick={() => setPending({ player: p, ban: true })}>
                Ban
              </Button>
            </li>
          ))}
        </ul>
        {kickLocked && (
          <p id="kick-locked" className="manage__hint">
            Kick is off: a match needs at least {room.minPlayers} players. You can still ban.
          </p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal__actions">
          <Button variant="secondary" onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
