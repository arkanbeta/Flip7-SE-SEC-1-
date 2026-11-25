import { Link, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import GoogleButton from './GoogleButton.jsx';
import { signInErrorMessage } from './authMessages.js';

export default function LoginPage() {
  const [params] = useSearchParams();
  const errorMessage = signInErrorMessage(params.get('error'));

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to join your friends.">
      {errorMessage && (
        <p className="form-alert" role="alert">
          {errorMessage}
        </p>
      )}
      <GoogleButton intent="login" />
      <p className="auth-card__switch">
        New here? <Link to="/create-account">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
