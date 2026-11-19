import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Boxes, Eye, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, ScanLine, Sunrise,
} from 'lucide-react';
import { NAV_PAGES, type NavPage } from '@/components/layout/navPages';
import { DailyReport, useDailyReport } from '@/components/report/DailyReport';
import { ScanDialog } from '@/components/scan/ScanDialog';
import { ScannerProvider } from '@/components/scan/ScannerProvider';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useAuth } from '@/context/AuthContext';
import { useMachineFocus } from '@/context/FocusContext';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useItems } from '@/hooks/useCatalog';
import { applyLayout, normalizeLayout, type NavId } from '@/lib/navigation';
import type { Dashboard, JobRequest, MaintenanceData, ReorderData } from '@/lib/types';
import styles from '@/components/layout/AppShell.module.css';

interface NavItem extends NavPage {
  /** Shown in the phone tab bar; the rest live under "More". */
  primary: boolean;
  desktop: boolean;
  phone: boolean;
  alert?: number;
}

const NEW_WORKSPACE = '__new__';
const SIDEBAR_KEY = 'filament-tracker.sidebar-collapsed';

/** Desktop sidebar: full width, or a narrow icon rail. Remembered per browser. */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((was) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, was ? '0' : '1');
      } catch {
        /* storage unavailable: the choice just lasts this visit */
      }
      return !was;
    });
  return [collapsed, toggle] as const;
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { workspace, workspaces, select, canOperate } = useWorkspace();
  const { data: dashboard } = useWsQuery<Dashboard>('/dashboard');
  const { data: maintenance } = useWsQuery<MaintenanceData>('/maintenance');
  const { data: reorder } = useWsQuery<ReorderData>('/reorder');
  const { data: requests } = useWsQuery<JobRequest[]>('/job-requests');
  const { items: stock } = useItems();
  const { machine, relates } = useMachineFocus();
  const [moreOpen, setMoreOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [collapsed, toggleSidebar] = useSidebarCollapsed();
  const report = useDailyReport();
  const navigate = useNavigate();

  // The badges follow the focus: with one machine picked they count only what concerns it.
  const related = new Set(stock.filter(relates).map((item) => item.id));
  const overdue = machine
    ? maintenance?.schedule.filter((entry) => entry.machineId === machine.id && entry.status === 'overdue').length
    : dashboard?.counts.overdue;
  const toReorder = machine
    ? reorder?.groups.reduce((sum, group) => sum + group.lines.filter((line) => related.has(line.itemId)).length, 0)
    : dashboard && dashboard.counts.lowStock + dashboard.counts.wornTools;
  const waiting = requests?.filter((request) => request.status === 'pending' && (!machine || request.machine?.id === machine.id)).length;

  // Order, tab bar and which pages show on each device are the user's own (Settings, Navigation); the badges stay with their page wherever it moves.
  const alerts: Partial<Record<NavId, number | undefined>> = { jobs: waiting, maintenance: overdue, reorder: toReorder };
  const items: NavItem[] = applyLayout(NAV_PAGES, normalizeLayout(user?.navigation)).map((page) => ({ ...page, alert: alerts[page.id] }));

  const switchWorkspace = (id: string) => {
    setMoreOpen(false);
    if (id === NEW_WORKSPACE) navigate('/new-workspace');
    else {
      select(id);
      navigate('/');
    }
  };

  const switcher = (
    <label className={styles.switcher}>
      <span className={styles.switcherLabel}>Workspace</span>
      <Select icon={Boxes} className={styles.switcherSelect} value={workspace?.id ?? ''} onChange={(e) => switchWorkspace(e.target.value)}>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
        <option value={NEW_WORKSPACE}>+ New workspace…</option>
      </Select>
    </label>
  );

  const link = (item: NavItem, className: string, onClick?: () => void) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/'}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => `${className} ${isActive ? styles.active : ''}`}
    >
      <item.icon size={20} aria-hidden />
      <span className={styles.linkLabel}>{item.label}</span>
      {item.alert ? <span className={styles.alert}>{item.alert}</span> : null}
    </NavLink>
  );

  // Not a screen of its own: the report opens over whatever is on screen, and by itself on the first visit of the day.
  const reportButton = (onClick?: () => void) => (
    <button
      type="button"
      className={`${styles.navLink} ${styles.navButton}`}
      title={collapsed ? 'Daily report' : undefined}
      onClick={() => {
        onClick?.();
        report.show();
      }}
    >
      <Sunrise size={20} aria-hidden />
      <span className={styles.linkLabel}>Daily report</span>
    </button>
  );

  // Scanning a label is how you get to an item or a location with your hands full: always one tap away.
  const scanButton = (className: string) => (
    <button type="button" className={`${styles.navLink} ${styles.navButton} ${className}`} title={collapsed ? 'Scan a label' : undefined} onClick={() => setScanning(true)}>
      <ScanLine size={20} aria-hidden />
      <span className={styles.linkLabel}>Scan</span>
    </button>
  );

  // A guest has no email to show; offer the way to keep what they have set up instead.
  const keepWork = (onNavigate?: () => void) => (
    <Link to="/register" className={styles.accountLink} onClick={onNavigate}>
      Create account to keep this
    </Link>
  );

  return (
    <ScannerProvider>
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ''}`}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img className={styles.brandIcon} src="/icon.svg" alt="" width={28} height={28} />
          <span className={styles.brandName}>Wrkbench</span>
          <IconButton
            className={styles.sidebarToggle}
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            size="sm"
            onClick={toggleSidebar}
          />
        </div>
        {!collapsed && switcher}
        <nav className={styles.nav} aria-label="Main">
          {items.filter((i) => i.desktop).map((item) => link(item, styles.navLink))}
          {scanButton(styles.navEnd)}
          {reportButton()}
        </nav>
        <div className={styles.account}>
          <div className={styles.accountText}>
            <span className={styles.accountName}>{user?.name}</span>
            {user?.isGuest ? keepWork() : <span className={styles.accountRole}>{workspace?.role}</span>}
          </div>
          {collapsed ? (
            <IconButton icon={LogOut} label="Sign out" size="sm" onClick={logout} />
          ) : (
            <Button variant="ghost" size="sm" icon={LogOut} onClick={logout}>
              Sign out
            </Button>
          )}
        </div>
      </aside>

      <header className={styles.topbar}>
        <img src="/icon.svg" alt="" width={26} height={26} />
        <span className={styles.topbarTitle}>{workspace?.name}</span>
        {!canOperate && (
          <Badge tone="info" icon={Eye}>
            View only
          </Badge>
        )}
        <IconButton icon={ScanLine} label="Scan a label" onClick={() => setScanning(true)} />
      </header>

      <main className={styles.main}>
        <div className={styles.content}>
          {!canOperate && (
            <p className={styles.viewerNote}>
              <Eye size={16} aria-hidden /> You have view-only access to this workspace.
            </p>
          )}
          <Outlet />
        </div>
      </main>

      <nav className={styles.tabbar} aria-label="Main">
        {items.filter((i) => i.primary).map((item) => link(item, styles.tab))}
        <button type="button" className={styles.tab} onClick={() => setMoreOpen(true)}>
          <Menu size={20} aria-hidden />
          <span className={styles.linkLabel}>More</span>
          {items.some((i) => !i.primary && i.phone && i.alert) && <span className={styles.alertDot} aria-label="Needs attention" />}
        </button>
      </nav>

      {moreOpen && (
        <Modal title="More" onClose={() => setMoreOpen(false)}>
          {switcher}
          <div className={styles.moreLinks}>
            {items.filter((i) => !i.primary && i.phone).map((item) => link(item, styles.navLink, () => setMoreOpen(false)))}
            {reportButton(() => setMoreOpen(false))}
          </div>
          <Button icon={Plus} onClick={() => switchWorkspace(NEW_WORKSPACE)}>
            New workspace
          </Button>
          <div className={styles.account}>
            <div className={styles.accountText}>
              <span className={styles.accountName}>{user?.name}</span>
              {user?.isGuest ? keepWork(() => setMoreOpen(false)) : <span className={styles.accountEmail}>{user?.email}</span>}
            </div>
            <Button variant="ghost" size="sm" icon={LogOut} onClick={logout}>
              Sign out
            </Button>
          </div>
        </Modal>
      )}

      {scanning && <ScanDialog onClose={() => setScanning(false)} />}
      {report.mode !== 'closed' && <DailyReport auto={report.mode === 'auto'} onClose={report.close} />}
    </div>
    </ScannerProvider>
  );
}
