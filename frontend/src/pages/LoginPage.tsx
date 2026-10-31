import { type FormEvent, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Navigate, useSearchParams } from 'react-router-dom';
import { apiUrl } from '../api/client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useMe } from '../hooks/useQueries';

function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const LOGIN_ERRORS: Record<string, string> = {
  invalid_state: 'Your login session expired. Please try again.',
  google_denied: 'Google sign-in was cancelled.',
  google_exchange_failed: 'Google sign-in failed. Please try again.',
  google_profile_incomplete: 'Your Google account did not share an email address.',
};

const FIELD = 'h-[62px] w-full rounded-lg bg-field px-5 text-[16px] text-ink placeholder:text-[#8A8D8A]';

export function LoginPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const error = params.get('error');
    if (error) toast.error(LOGIN_ERRORS[error] ?? 'Login failed. Please try again.');
  }, [params]);

  if (me.data) return <Navigate to="/scheduled" replace />;

  // Only Google sign-in exists. The form validates, but never pretends to log anyone in.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMessage(!email.trim() || !password ? 'Enter your email and password.' : 'Email sign-in is not enabled in this demo. Please use Login with Google.');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="h-[554px] w-[554px] max-w-full rounded-[14px] border border-line px-16 pt-[61px] max-[620px]:px-6">
        <h1 className="text-center text-[41px] font-bold leading-[48px] text-ink-strong">Login</h1>

        <Button variant="soft" onClick={() => window.location.assign(apiUrl('/api/auth/google'))} className="mt-[33px] h-[54px] w-full rounded-lg text-[17.5px] font-normal">
          <GoogleLogo />
          Login with Google
        </Button>

        <div className="mt-[20px] flex h-5 items-center gap-4">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[16px] text-[#B4B8B4]">or sign up through email</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={submit} noValidate>
          <Input type="email" autoComplete="email" placeholder="Email ID" aria-label="Email ID" value={email} onChange={(e) => setEmail(e.target.value)} className={`${FIELD} mt-[33px]`} />
          <Input type="password" autoComplete="current-password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${FIELD} mt-[13px]`} />
          <Button type="submit" variant="solid" className="mt-[32px] h-[54px] w-full rounded-lg text-[18px] font-normal">
            Login
          </Button>
          {message && (
            <p role="alert" className="mt-2 text-center text-[13px] leading-4 text-danger">
              {message}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
