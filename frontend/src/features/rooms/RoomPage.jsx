import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import Page from '../../components/Page.jsx';
import Avatar from '../../components/Avatar.jsx';
import Button from '../../components/Button.jsx';
import { LoadingScreen } from '../../components/FullPageMessage.jsx';
import ManagePlayersDialog from './ManagePlayersDialog.jsx';
import { answerStartPrompt, leaveRoom, removePlayer, sendGameAction, setReady, startGame, startRematch } from '../../services/api.js';
import { useAuth } from '../../hooks/useAuth.js';
import GameBoard from '../game/GameBoard.jsx';
import LeaveMatchDialog from '../game/LeaveMatchDialog.jsx';
import { roomErrorMessage } from '../lobby/roomMessages.js';
import { normalizeRoomCode } from '../../utils/roomCode.js';
import { useCurrentRoom } from './useCurrentRoom.js';
import { formatClock, useCountdown } from './useCountdown.js';
import '../lobby/RoomForms.css';
import './RoomPage.css';

export default function RoomPage() {
  const { code: codeParam } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { room, loading, error, status, setRoom, refresh, clockOffset, removed } = useCurrentRoom({ live: true });
  const [managing, setManaging] = useState(false);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  async function act(fn) {
    setBusy(true);
    setActionError('');
    try {
      const result = await fn();
      if (result?.room) setRoom(result.room);
      return result;
    } catch (e) {
      setActionError(roomErrorMessage(e));
      refresh();
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Leaving a match that is still being played costs the player their points: ask first.
  // (Someone who is only watching loses nothing, so they are not asked.)
  const matchRunning = Boolean(room?.game && room.game.phase !== 'finished' && !room.isSpectator);

  async function leaveNow(confirm) {
    const result = await act(() => leaveRoom(confirm));
    setConfirmLeave(false);
    if (result) navigate('/lobby', { replace: true });
  }
  const handleLeave = () => (matchRunning ? setConfirmLeave(true) : leaveNow(false));

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the code is shown on screen anyway */
    }
  }

  if (loading) return <LoadingScreen />;
  if (!room) {
    return (
      <main className="full-page-message" role="alert">
        <h1>{error ? "Can't reach the room" : removed ? 'You were removed from the room' : 'This room is closed'}</h1>
        <p>
          {error
            ? roomErrorMessage(error)
            : removed === 'banned'
              ? 'The host banned you from this room, so you cannot join it again. You can still play in other rooms.'
              : removed
                ? 'The host removed you from this room.'
                : 'The room does not exist any more, or you are not in it.'}
        </p>
        <p>
          <Link to="/lobby">Back to the lobby</Link>
        </p>
      </main>
    );
  }
  // The URL always shows the room you are actually in.
  if (normalizeRoomCode(codeParam ?? '') !== room.code) return <Navigate to={`/rooms/${room.code}`} replace />;

  // One banner, used on both screens, so a lost connection always looks the same.
  const connectionBanner = (status === 'reconnecting' || status === 'offline') && (
    <p className="room__connection" role="status">
      {status === 'reconnecting'
        ? 'Connection lost. Reconnecting… (you keep your seat for a short time)'
        : 'Live updates are off. Reload the page to reconnect.'}
    </p>
  );

  // Host tools: one quiet button; kicking and banning stay out of sight until it is opened.
  const manageButton = room.isCreator && room.playerCount > 1 && (
    <Button
      variant="secondary"
      onClick={() => {
        setActionError('');
        setManaging(true);
      }}
    >
      Manage players
    </Button>
  );
  const manageDialog = room.isCreator && (
    <ManagePlayersDialog
      open={managing}
      room={room}
      me={user.id}
      busy={busy}
      error={actionError}
      onClose={() => setManaging(false)}
      onRemove={async (playerId, ban) => {
        if (await act(() => removePlayer(playerId, ban))) setManaging(false);
      }}
    />
  );

  if (room.game) {
    return (
      <Page className="page room">
        {connectionBanner}
        <header className="room__top">
          <div>
            <p className="room__mode">{room.gameMode.name} mode</p>
            <h1>Game on</h1>
          </div>
          <div className="room__actions">
            {manageButton}
            <Button variant="secondary" onClick={handleLeave} loading={busy}>
              Leave match
            </Button>
          </div>
        </header>
        {room.isSpectator && (
          <p className="room__spectating" role="status">
            You are watching this match. You can play in the next one.
          </p>
        )}
        <GameBoard
          room={room}
          me={user.id}
          clockOffset={clockOffset}
          busy={busy}
          onAction={(action) => act(() => sendGameAction(action))}
          onReady={(ready) => act(() => setReady(ready))}
          onStartWithReady={() => act(startRematch)}
        />
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
        <LeaveMatchDialog open={confirmLeave} busy={busy} onCancel={() => setConfirmLeave(false)} onConfirm={() => leaveNow(true)} />
        {manageDialog}
      </Page>
    );
  }

  return (
    <Page className="page room">
      {connectionBanner}
      <header className="room__top">
        <div>
          <p className="room__mode">{room.gameMode.name} mode</p>
          <h1>Waiting room</h1>
        </div>
        <button type="button" className="room__code" onClick={copyCode} aria-label={`Room code ${room.code}. Copy`}>
          <span className="room__code-label">Room code</span>
          <span className="room__code-value">{room.code}</span>
          <span className="room__code-copy" aria-live="polite">{copied ? 'Copied!' : 'Tap to copy'}</span>
        </button>
      </header>

      {room.status === 'In Progress' ? (
        <section className="room__notice" role="status">
          <h2>The game is starting…</h2>
          <p>The table opens in a moment.</p>
        </section>
      ) : (
        <p className="room__count" role="status">
          {room.playerCount} of {room.maxPlayers} players
          {room.playerCount < room.minPlayers && ` (at least ${room.minPlayers} needed to start)`}
        </p>
      )}

      <ul className="room__players" aria-label="Players">
        {room.players.map((p) => (
          <li key={p.id} className={`room__player${p.id === user.id ? ' room__player--me' : ''}`}>
            <Avatar id={p.avatar} name="" size={48} />
            <span className="room__player-name">
              {p.nickname}
              {p.id === user.id && <span className="room__you"> (you)</span>}
            </span>
            {p.isCreator && <span className="room__badge">Host</span>}
          </li>
        ))}
        {Array.from({ length: room.maxPlayers - room.playerCount }, (_, i) => (
          <li key={`empty-${i}`} className="room__player room__player--empty" aria-label="Open seat">
            Waiting for a player…
          </li>
        ))}
      </ul>

      {room.status === 'Waiting' && room.isCreator && <HostControls room={room} busy={busy} act={act} clockOffset={clockOffset} />}
      {room.status === 'Waiting' && !room.isCreator && room.playerCount >= room.minPlayers && (
        <p className="room__wait">Waiting for the host to start the game.</p>
      )}

      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      <div className="room__footer">
        {manageButton}
        <Button variant="secondary" onClick={handleLeave} loading={busy}>
          Leave room
        </Button>
      </div>
      {manageDialog}
    </Page>
  );
}

function HostControls({ room, busy, act, clockOffset }) {
  const autoLeft = useCountdown(room.startPrompt?.autoStartAt ?? null, clockOffset);
  const nextLeft = useCountdown(room.nextPromptAt ?? null, clockOffset);

  if (room.startPrompt) {
    return (
      <section className="room__prompt" aria-labelledby="start-q">
        <h2 id="start-q">Start the game now?</h2>
        <p>
          {room.playerCount} players are here. If you do not answer, the game starts by itself in{' '}
          <strong>{formatClock(autoLeft ?? 0)}</strong>.
        </p>
        <div className="room__prompt-actions">
          <Button onClick={() => act(() => answerStartPrompt('yes'))} disabled={busy}>
            Yes, start
          </Button>
          <Button variant="secondary" onClick={() => act(() => answerStartPrompt('no'))} disabled={busy}>
            Not yet
          </Button>
        </div>
      </section>
    );
  }
  if (!room.canStart) return null;
  return (
    <section className="room__prompt">
      <p>
        You will be asked again in <strong>{formatClock(nextLeft ?? 0)}</strong>, or start whenever you are ready.
      </p>
      <Button onClick={() => act(startGame)} disabled={busy}>
        Start game
      </Button>
    </section>
  );
}
