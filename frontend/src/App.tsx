import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { ComposePage } from './pages/ComposePage';
import { EmailDetailPage } from './pages/EmailDetailPage';
import { LoginPage } from './pages/LoginPage';
import { ScheduledPage } from './pages/ScheduledPage';
import { SentPage } from './pages/SentPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<Navigate to="/scheduled" replace />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/scheduled" element={<ScheduledPage />} />
          <Route path="/sent" element={<SentPage />} />
        </Route>
        <Route path="/email/:id" element={<EmailDetailPage />} />
        <Route path="/compose" element={<ComposePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/scheduled" replace />} />
    </Routes>
  );
}
