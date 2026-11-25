import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { getProfile, getMyMatches } from '../../services/api.js';
import Page from '../../components/Page.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Avatar from '../../components/Avatar.jsx';
import Button from '../../components/Button.jsx';
import { PencilIcon, LogOutIcon } from '../../components/icons.jsx';
import StatsGrid from './StatsGrid.jsx';
import MatchHistory from './MatchHistory.jsx';
import EditProfileModal from './EditProfileModal.jsx';
import './ProfilePage.css';

export default function ProfilePage() {
  const { user, setUser, signOut } = useAuth();
  const [data, setData] = useState({ status: 'loading', profile: null, matches: [] });
  const [editing, setEditing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    setData((current) => ({ ...current, status: 'loading' }));
    try {
      const [profile, history] = await Promise.all([getProfile(), getMyMatches(10)]);
      setData({ status: 'ready', profile, matches: history.matches });
    } catch {
      setData({ status: 'error', profile: null, matches: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut(); // the route guard then sends the person to /login
  }

  return (
    <Page>
      <PageHeader title="Your profile" />

      <section className="surface profile-card" aria-label="Account">
        <Avatar id={user.avatar} name={`${user.nickname}'s avatar`} size={96} />
        <div className="profile-card__info">
          <h2 className="profile-card__name">{user.nickname}</h2>
          <p className="profile-card__email">{user.email}</p>
        </div>
        <div className="profile-card__actions">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <PencilIcon size={18} /> Edit profile
          </Button>
          <Button variant="secondary" onClick={handleSignOut} loading={signingOut}>
            <LogOutIcon size={18} /> Log out
          </Button>
        </div>
      </section>

      {data.status === 'loading' && (
        <p className="profile-status" role="status">
          Loading your statistics...
        </p>
      )}
      {data.status === 'error' && (
        <div className="profile-status profile-status--error" role="alert">
          <p>We couldn&rsquo;t load your statistics.</p>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      )}
      {data.status === 'ready' && (
        <>
          <section aria-labelledby="stats-title">
            <h2 id="stats-title" className="profile-section-title">
              Statistics
            </h2>
            <StatsGrid totalPoints={data.profile.user.totalPoints} stats={data.profile.stats} />
          </section>
          <section aria-labelledby="history-title">
            <h2 id="history-title" className="profile-section-title">
              Recent matches
            </h2>
            <MatchHistory matches={data.matches} />
          </section>
        </>
      )}

      <EditProfileModal open={editing} onClose={() => setEditing(false)} user={user} onSaved={setUser} />
    </Page>
  );
}
