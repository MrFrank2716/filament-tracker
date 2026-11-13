import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState, Loading } from '@/components/ui/Display';
import { ConfirmProvider } from '@/components/ui/Modal';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { FocusProvider } from '@/context/FocusContext';
import { useWorkspace, WorkspaceProvider } from '@/context/WorkspaceContext';
import { ActivityPage } from '@/pages/ActivityPage';
import { AuthPage } from '@/pages/AuthPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { JobsPage } from '@/pages/JobsPage';
import { OverviewPage } from '@/pages/MachineOverviewPage';
import { MachinesPage } from '@/pages/MachinesPage';
import { MaintenancePage } from '@/pages/MaintenancePage';
import { NewWorkspacePage } from '@/pages/NewWorkspacePage';
import { ReorderPage } from '@/pages/ReorderPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SubmitRequestPage } from '@/pages/SubmitRequestPage';
import { TrackRequestPage } from '@/pages/TrackRequestPage';

function RequireAuth() {
  const { user, loading, error, retry } = useAuth();
  if (loading) return <Loading />;
  if (!user && error) {
    return (
      <EmptyState icon={WifiOff} title="Cannot reach the server" action={<Button variant="primary" onClick={retry}>Try again</Button>}>
        {error} You are still signed in.
      </EmptyState>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireWorkspace() {
  const { workspace, loading, error, retry } = useWorkspace();
  if (loading) return <Loading label="Opening your workspace" />;
  if (!workspace && error) {
    return (
      <EmptyState icon={WifiOff} title="Cannot load your workspaces" action={<Button variant="primary" onClick={retry}>Try again</Button>}>
        {error}
      </EmptyState>
    );
  }
  if (!workspace) return <Navigate to="/new-workspace" replace />;
  // Keyed so that switching workspace resets every screen's local state.
  return (
    <FocusProvider key={workspace.id} workspaceId={workspace.id}>
      <AppShell />
    </FocusProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <WorkspaceProvider>
              <Routes>
                <Route path="/login" element={<AuthPage mode="login" />} />
                <Route path="/register" element={<AuthPage mode="register" />} />
                {/* Open to anyone holding the link: sending a job request and following its progress. */}
                <Route path="/submit/:token" element={<SubmitRequestPage />} />
                <Route path="/request/:token" element={<TrackRequestPage />} />
                <Route element={<RequireAuth />}>
                  <Route path="/new-workspace" element={<NewWorkspacePage />} />
                  <Route element={<RequireWorkspace />}>
                    <Route index element={<OverviewPage />} />
                    <Route path="inventory" element={<InventoryPage />} />
                    <Route path="machines" element={<MachinesPage />} />
                    <Route path="jobs" element={<JobsPage />} />
                    <Route path="maintenance" element={<MaintenancePage />} />
                    <Route path="reorder" element={<ReorderPage />} />
                    <Route path="activity" element={<ActivityPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </WorkspaceProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
