import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AuthProvider } from './AuthProvider.jsx';
import { routes } from './router.jsx';

const router = createBrowserRouter(routes);

// Global providers wrap the router. The socket provider joins them in Phase 5.
export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </MotionConfig>
  );
}
