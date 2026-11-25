import { Navigate } from 'react-router-dom';
import { ProtectedRoute, PublicOnlyRoute } from '../components/RouteGuards.jsx';
import LoginPage from '../features/auth/LoginPage.jsx';
import CreateAccountPage from '../features/auth/CreateAccountPage.jsx';
import ProfileSetupPage from '../features/auth/ProfileSetupPage.jsx';
import LobbyPage from '../features/lobby/LobbyPage.jsx';
import ProfilePage from '../features/profile/ProfilePage.jsx';
import RulesPage from '../features/rules/RulesPage.jsx';
import RoomPage from '../features/rooms/RoomPage.jsx';

// All routes are declared here (as data, so tests can mount them in a memory router).
export const routes = [
  { path: '/', element: <Navigate to="/lobby" replace /> },
  {
    element: <PublicOnlyRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/create-account', element: <CreateAccountPage /> },
    ],
  },
  // Guards for this page live inside it: it needs a *pending* Google sign-in, not a user.
  { path: '/create-account/profile', element: <ProfileSetupPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/lobby', element: <LobbyPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/rules', element: <RulesPage /> },
      { path: '/rooms/:code', element: <RoomPage /> },
    ],
  },
  {
    path: '*',
    element: (
      <main className="full-page-message">
        <h1>Page not found</h1>
        <p>
          <a href="/">Go back home</a>
        </p>
      </main>
    ),
  },
];
