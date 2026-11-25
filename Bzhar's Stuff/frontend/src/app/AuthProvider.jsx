import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  getMe,
  registerAccount,
  logout as logoutRequest,
  setCsrfToken,
} from '../services/api.js';

export const AuthContext = createContext(null);

// Holds "who is signed in?" for the whole app. The BACKEND session is the source of
// truth; this just mirrors what GET /api/auth/me last said.
//   status: 'loading' | 'ready' | 'error' (backend unreachable)
//   user:   the signed-in user, or null
//   pendingProfile: { email } while a new Google account still has to pick a nickname/avatar
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, pendingProfile: null });

  const applySession = useCallback((data) => {
    setCsrfToken(data.csrfToken);
    setState({ status: 'ready', user: data.user, pendingProfile: data.pendingProfile ?? null });
  }, []);

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading' }));
    try {
      applySession(await getMe());
    } catch {
      setCsrfToken(null);
      setState({ status: 'error', user: null, pendingProfile: null });
    }
  }, [applySession]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const register = useCallback(async (input) => {
    const data = await registerAccount(input);
    setCsrfToken(data.csrfToken);
    setState({ status: 'ready', user: data.user, pendingProfile: null });
    return data.user;
  }, []);

  // Called after a profile edit so the whole app shows the new nickname/avatar at once.
  const setUser = useCallback((user) => {
    setState((current) => ({ ...current, user }));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      // Even if the request failed, stop showing the person as signed in here;
      // the next /me call will tell the truth.
      setCsrfToken(null);
      setState({ status: 'ready', user: null, pendingProfile: null });
    }
  }, []);

  const value = useMemo(() => ({ ...state, refresh, register, signOut, setUser }), [state, refresh, register, signOut, setUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
