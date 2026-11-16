import { ClipboardList, Cog, History, LayoutDashboard, Package, Settings, ShoppingCart, Wrench, type LucideIcon } from 'lucide-react';
import type { NavId } from '@/lib/navigation';

export interface NavPage {
  id: NavId;
  to: string;
  label: string;
  icon: LucideIcon;
}

/** The app's main pages in their standard order. Each user may reorder them (Settings, Navigation). */
export const NAV_PAGES: NavPage[] = [
  { id: 'overview', to: '/', label: 'Overview', icon: LayoutDashboard },
  { id: 'inventory', to: '/inventory', label: 'Inventory', icon: Package },
  { id: 'jobs', to: '/jobs', label: 'Jobs', icon: ClipboardList },
  { id: 'maintenance', to: '/maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'machines', to: '/machines', label: 'Machines', icon: Cog },
  { id: 'reorder', to: '/reorder', label: 'Reorder', icon: ShoppingCart },
  { id: 'activity', to: '/activity', label: 'Activity', icon: History },
  { id: 'settings', to: '/settings', label: 'Settings', icon: Settings },
];
