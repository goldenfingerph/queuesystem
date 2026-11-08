import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ROLE_PERMISSIONS, type ModuleId, type StaffRole } from '@/types/domain';
import { LoginPage } from '@/modules/LoginPage';
import { DashboardModule } from '@/modules/DashboardModule';
import { ServicesModule } from '@/modules/ServicesModule';
import { CountersModule } from '@/modules/CountersModule';
import { StaffModule } from '@/modules/StaffModule';
import { QueueSettingsModule } from '@/modules/QueueSettingsModule';
import { ReceptionModule } from '@/modules/ReceptionModule';
import { CounterDeskModule } from '@/modules/CounterDeskModule';
import { TvDisplayModule } from '@/modules/TvDisplayModule';
import { ReportsModule } from '@/modules/ReportsModule';
import { SystemSettingsModule } from '@/modules/SystemSettingsModule';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function getRoute(): string {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return hash || '';
}

function useRoute(): [string, (r: string) => void] {
  const [route, setRoute] = useState(getRoute());
  useEffect(() => {
    const handler = () => setRoute(getRoute());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  const navigate = (r: string) => { window.location.hash = '/' + r; };
  return [route, navigate];
}

function Router() {
  const { user, loading } = useAuth();
  const [route] = useRoute();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-950">
        <Loader2 className="h-8 w-8 animate-spin text-brand-400" />
      </div>
    );
  }

  // TV display is a public route — no auth required (for TV browser)
  if (route === 'tv-display' || route === 'tv') {
    return <TvDisplayModule />;
  }

  if (!user) {
    return <LoginPage />;
  }

  const role = user.role as StaffRole;
  const allowed = ROLE_PERMISSIONS[role] ?? [];
  const moduleId = (route || 'dashboard') as ModuleId;

  // If user doesn't have access to the requested module, redirect to their first allowed module
  if (!allowed.includes(moduleId)) {
    const fallback = allowed[0] ?? 'dashboard';
    if (fallback !== moduleId) {
      window.location.hash = '/' + fallback;
      return null;
    }
  }

  switch (moduleId) {
    case 'dashboard': return <DashboardModule />;
    case 'services': return <ServicesModule />;
    case 'counters': return <CountersModule />;
    case 'staff': return <StaffModule />;
    case 'queue-settings': return <QueueSettingsModule />;
    case 'reception': return <ReceptionModule />;
    case 'counter-desk': return <CounterDeskModule />;
    case 'reports': return <ReportsModule />;
    case 'system-settings': return <SystemSettingsModule />;
    case 'tv-display': return <TvDisplayModule />;
    default: return <DashboardModule />;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router />
      </AuthProvider>
    </ErrorBoundary>
  );
}
