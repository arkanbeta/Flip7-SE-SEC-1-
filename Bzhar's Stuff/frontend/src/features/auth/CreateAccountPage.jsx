import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import GoogleButton from './GoogleButton.jsx';

export default function CreateAccountPage() {
  return (
    <AuthLayout title="Create your account" subtitle="Use Google to get started. You'll pick a nickname and avatar next.">
      <GoogleButton intent="register" />
      <p className="auth-card__switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
