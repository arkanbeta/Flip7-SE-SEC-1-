import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import Page from '../../components/Page.jsx';
import Avatar from '../../components/Avatar.jsx';
import PlayingCard from '../../components/PlayingCard.jsx';
import { PlusCircleIcon, EnterIcon, BookIcon } from '../../components/icons.jsx';
import { useCurrentRoom } from '../rooms/useCurrentRoom.js';
import JoinGameModal from './JoinGameModal.jsx';
import CreateGameModal from './CreateGameModal.jsx';
import './LobbyPage.css';

export default function LobbyPage() {
  const { user } = useAuth();
  const [dialog, setDialog] = useState(null); // 'create' | 'join' | null
  const { room } = useCurrentRoom(); // set when the player is already in a room

  return (
    <Page className="page lobby">
      <header className="lobby__top">
        <p className="lobby__brand">Flip 7 Online</p>
        <Link to="/profile" className="lobby__profile" aria-label={`Your profile (${user.nickname})`}>
          <span className="lobby__nickname">{user.nickname}</span>
          <Avatar id={user.avatar} name="" size={48} />
        </Link>
      </header>

      <section className="lobby__hero" aria-labelledby="lobby-title">
        <div className="lobby__cards" aria-hidden="true">
          <PlayingCard label="7" faceUp size="md" className="lobby__card lobby__card--left" />
          <PlayingCard label="7" faceUp={false} size="md" className="lobby__card lobby__card--right" />
        </div>
        <h1 id="lobby-title">Ready to play, {user.nickname}?</h1>
        <p className="lobby__lead">Start a private room and share its code, or join your friends with theirs.</p>
      </section>

      {/* Already seated somewhere: going back is THE thing to do, so it becomes the one
          highlighted action and "Create Game" steps down to an ordinary card. */}
      {room && (
        <Link to={`/rooms/${room.code}`} className="lobby-action lobby-action--primary lobby__resume">
          <EnterIcon size={32} />
          <span className="lobby-action__title">Return to room {room.code}</span>
          <span className="lobby-action__text">{room.game ? 'Your match is still being played' : 'Your seat is waiting for you'}</span>
        </Link>
      )}

      <nav className="lobby__actions" aria-label="Main menu">
        <button type="button" className={`lobby-action${room ? '' : ' lobby-action--primary'}`} onClick={() => setDialog('create')}>
          <PlusCircleIcon size={32} />
          <span className="lobby-action__title">Create Game</span>
          <span className="lobby-action__text">Open a private room</span>
        </button>
        <button type="button" className="lobby-action" onClick={() => setDialog('join')}>
          <EnterIcon size={32} />
          <span className="lobby-action__title">Join Game</span>
          <span className="lobby-action__text">Enter a room code</span>
        </button>
        <Link to="/rules" className="lobby-action">
          <BookIcon size={32} />
          <span className="lobby-action__title">Rules</span>
          <span className="lobby-action__text">Learn how to play</span>
        </Link>
      </nav>

      <CreateGameModal open={dialog === 'create'} onClose={() => setDialog(null)} />
      <JoinGameModal open={dialog === 'join'} onClose={() => setDialog(null)} />
    </Page>
  );
}
