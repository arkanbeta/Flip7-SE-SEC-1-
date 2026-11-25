import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { LoadingScreen, ConnectionError } from './FullPageMessage.jsx';

// Wrap pages that need a signed-in user. IMPORTANT: this only decides what the
// browser SHOWS. The backend independently refuses every protected request.
export function ProtectedRoute() {
  const { status, user, refresh } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'error') return <ConnectionError onRetry={refresh} />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

// Wrap pages only for visitors (login, create account): signed-in users go to the lobby.
export function PublicOnlyRoute() {
  const { status, user, refresh } = useAuth();

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'error') return <ConnectionError onRetry={refresh} />;
  if (user) return <Navigate to="/lobby" replace />;
  return <Outlet />;
}
