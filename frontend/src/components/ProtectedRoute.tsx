import { Navigate, Outlet } from 'react-router-dom';
import { useMe } from '../hooks/useQueries';
import { Spinner } from './ui/Spinner';

/** Everything behind login. GET /api/auth/me decides; a 401 goes to /login. */
export function ProtectedRoute() {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-muted">
        <Spinner size={24} />
      </div>
    );
  }
  if (me.isError) return <Navigate to="/login" replace />;
  return <Outlet />;
}
