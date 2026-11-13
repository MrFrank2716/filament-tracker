import type { Appearance } from '@/lib/themes';

export type Role = 'owner' | 'editor' | 'viewer';
export type FieldValue = string | number | boolean | null;
export type FieldType = 'text' | 'number' | 'select' | 'boolean' | 'color' | 'date';
export type MachineStatus = 'ready' | 'in_use' | 'needs_service' | 'offline';
export type JobStatus = 'planned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type DueStatus = 'ok' | 'soon' | 'overdue';

export interface User {
  id: string;
  email: string;
  name: string;
  /** A try-it-out session: no email or password yet, removed after a week unless it registers. */
  isGuest: boolean;
  /** Personal theme. Missing from an older server: treat as the default. */
  appearance?: Appearance;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  currency: string;
  role: Role;
  counts?: { items: number; machines: number; members: number };
}

export interface Member {
  id: string;
  role: Role;
  userId: string;
  name: string;
  email: string;
}

export interface Unit {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface Supplier {
  id: string;
  name: string;
  website: string;
  email: string;
  notes: string;
}

export interface Location {
  id: string;
  name: string;
  kind: string;
  code: string;
  parentId: string | null;
}

export interface CustomField {
  id?: string;
  key: string;
  label: string;
  fieldType: FieldType;
  unit: string;
  options: string[];
  required: boolean;
  showInList: boolean;
  isSizeDimension: boolean;
}

export interface ItemType {
  id: string;
  name: string;
  icon: string;
  color: string;
  defaultUnitId: string | null;
  tracksLife: boolean;
  sortOrder: number;
  fields: CustomField[];
  _count?: { items: number };
}

export interface Item {
  id: string;
  itemTypeId: string;
  name: string;
  sku: string;
  quantity: number;
  capacity: number | null;
  minQuantity: number;
  unitCost: number;
  unitId: string | null;
  supplierId: string | null;
  locationId: string | null;
  notes: string;
  fields: Record<string, FieldValue>;
  usageHours: number;
  lifeHours: number | null;
  wearFlag: boolean;
  isRemnant: boolean;
  parentId: string | null;
  compatibleMachineIds: string[];
  slot: { position: number; label: string; subUnit: { id: string; name: string; machineId: string | null } } | null;
  updatedAt: string;
}

export interface Movement {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  note: string;
  createdAt: string;
  user: { name: string } | null;
  job: { id: string; name: string } | null;
}

export interface MachineType {
  id: string;
  name: string;
  icon: string;
}

export interface Machine {
  id: string;
  machineTypeId: string | null;
  name: string;
  manufacturer: string;
  model: string;
  serial: string;
  status: MachineStatus;
  usageHours: number;
  hourlyCost: number;
  locationId: string | null;
  notes: string;
  compatibleItemIds: string[];
}

export interface Reading {
  label: string;
  value: string;
  unit: string;
}

export interface Slot {
  id: string;
  position: number;
  label: string;
  itemId: string | null;
}

export interface SubUnit {
  id: string;
  machineId: string | null;
  name: string;
  kind: string;
  readings: Reading[];
  statusNote: string;
  slots: Slot[];
}

export interface MaintenanceTask {
  id: string;
  name: string;
  description: string;
  machineId: string | null;
  machineTypeId: string | null;
  intervalDays: number | null;
  intervalHours: number | null;
  active: boolean;
}

export interface ScheduleEntry {
  taskId: string;
  taskName: string;
  description: string;
  machineId: string;
  machineName: string;
  inherited: boolean;
  intervalDays: number | null;
  intervalHours: number | null;
  status: DueStatus;
  lastDoneAt: string | null;
  lastDoneHours: number | null;
  dueDate: string | null;
  daysRemaining: number | null;
  hoursRemaining: number | null;
  progress: number;
}

export interface MaintenanceData {
  tasks: MaintenanceTask[];
  schedule: ScheduleEntry[];
}

export interface MaintenanceLog {
  id: string;
  machineId: string;
  performedAt: string;
  hoursAtService: number;
  notes: string;
  task: { name: string };
  machine: { name: string };
  user: { name: string } | null;
  parts: Array<{ id: string; quantity: number; item: { name: string } }>;
}

export interface JobUsage {
  id: string;
  itemId: string;
  quantity: number;
  hours: number;
  cost: number;
  item: { id: string; name: string; unitCost: number; lifeHours: number | null; quantity: number; unitId: string | null; itemTypeId: string };
}

export interface Job {
  id: string;
  machineId: string | null;
  name: string;
  status: JobStatus;
  durationHours: number;
  notes: string;
  extraCost: number;
  materialCost: number;
  toolingCost: number;
  machineCost: number;
  totalCost: number;
  createdAt: string;
  completedAt: string | null;
  machine: { id: string; name: string; hourlyCost: number } | null;
  createdBy: { name: string } | null;
  usages: JobUsage[];
  /** Set when the job came from an approved outside request. */
  request: { id: string; requesterName: string; requesterEmail: string; files: RequestFile[] } | null;
}

export type RequestStatus = 'pending' | 'changes_requested' | 'approved' | 'rejected';

export interface RequestFile {
  id: string;
  name: string;
  size: number;
}

/** A job someone outside the workspace asked for, with the files they sent for checking. */
export interface JobRequest {
  id: string;
  title: string;
  details: string;
  requesterName: string;
  requesterEmail: string;
  status: RequestStatus;
  reviewNote: string;
  reviewedAt: string | null;
  createdAt: string;
  /** Only sent to editors and owners, so they can pass the progress link on. */
  trackToken?: string;
  machine: { id: string; name: string } | null;
  job: { id: string; name: string; status: JobStatus } | null;
  reviewedBy: { name: string } | null;
  files: RequestFile[];
}

export interface UploadLimits {
  maxFiles: number;
  maxMb: number;
  extensions: string[];
}

export interface RequestLink {
  enabled: boolean;
  /** Null for viewers and while the link is off. */
  token: string | null;
  limits: UploadLimits;
}

/** What the public submission page is told about a workspace. */
export interface SubmitInfo {
  workspaceName: string;
  machines: Array<{ id: string; name: string; type: string }>;
  limits: UploadLimits;
}

/** What a requester sees when following their request. */
export interface TrackedRequest {
  workspaceName: string;
  title: string;
  details: string;
  requesterName: string;
  status: RequestStatus;
  reviewNote: string;
  createdAt: string;
  reviewedAt: string | null;
  machineName: string | null;
  jobStatus: JobStatus | null;
  /** Requests still waiting that were sent before this one. */
  ahead: number;
  files: Array<{ name: string; size: number }>;
  limits: UploadLimits;
}

export interface Dashboard {
  counts: { items: number; machines: number; openJobs: number; lowStock: number; wornTools: number; overdue: number; dueSoon: number };
  stockValue: number;
  month: { jobs: number; cost: number; hours: number };
  lowStock: Array<{ id: string; name: string; quantity: number; minQuantity: number; unitId: string | null; itemTypeId: string }>;
  wornTools: Array<{ id: string; name: string; usageHours: number; lifeHours: number | null; wearFlag: boolean }>;
  maintenance: ScheduleEntry[];
  machines: Array<{ id: string; name: string; status: MachineStatus; usageHours: number }>;
  recentJobs: Array<{ id: string; name: string; status: JobStatus; totalCost: number; durationHours: number; createdAt: string; completedAt: string | null; machine: { name: string } | null }>;
}

export interface ReorderLine {
  itemId: string;
  name: string;
  typeName: string;
  reason: 'low' | 'worn';
  quantity: number;
  minQuantity: number;
  unit: string;
  decimals: number;
  suggested: number;
  estimatedCost: number;
}

export interface ReorderData {
  groups: Array<{ supplier: { id: string; name: string; website: string; email: string } | null; lines: ReorderLine[]; total: number }>;
  total: number;
}

interface ReportAmount {
  unit: string;
  decimals: number;
}

/** One line of the daily action plan. The server states the facts; `describeAction` words them. */
export type ReportAction =
  | { kind: 'service'; urgency: 'today' | 'soon'; machineId: string; machineName: string; entries: ScheduleEntry[] }
  | { kind: 'machine'; urgency: 'today'; machineId: string; machineName: string }
  | ({ kind: 'shortfall'; urgency: 'today'; itemId: string; itemName: string; needed: number; available: number; jobs: string[] } & ReportAmount)
  | { kind: 'requests'; urgency: 'today'; count: number; oldestAt: string }
  | { kind: 'order'; urgency: 'today'; suppliers: string[]; items: string[]; unassigned: number; estimatedCost: number }
  | ({ kind: 'runout'; urgency: 'soon'; itemId: string; itemName: string; quantity: number; minQuantity: number; daysLeft: number } & ReportAmount)
  | { kind: 'wearing'; urgency: 'soon'; itemId: string; itemName: string; usageHours: number; lifeHours: number };

export interface ReportTotals {
  jobs: number;
  failed: number;
  hours: number;
  cost: number;
}

/** Shown on the first visit of each day: what to do, in order, and how the last week went. */
export interface DailyReport {
  generatedAt: string;
  actions: ReportAction[];
  /** Finished jobs over the last 24 hours, the last 7 days, and the 7 days before that. */
  activity: { day: ReportTotals; week: ReportTotals; previousWeek: ReportTotals };
  openJobs: { planned: number; inProgress: number };
  /** Last 30 days. */
  failures: { failed: number; total: number; machine: { name: string; failed: number } | null };
  busiestMachine: { name: string; hours: number } | null;
  /** Last 30 days, biggest spend first. */
  mostUsed: Array<{ itemId: string; name: string; used: number; cost: number; daysLeft: number | null } & ReportAmount>;
}

/** Portable workspace description. Only the parts the client edits are typed closely. */
export interface Snapshot {
  version: 1;
  workspace?: { name: string; description: string; currency: string };
  units: Array<{ ref: string; name: string; symbol: string }>;
  suppliers: unknown[];
  locations: unknown[];
  itemTypes: Array<{ ref: string; name: string; icon: string; color: string; fields: CustomField[] }>;
  machineTypes: Array<{ ref: string; name: string; icon: string }>;
  machines: Array<{ ref: string; name: string }>;
  items: unknown[];
  subUnits: unknown[];
  maintenanceTasks: Array<{ ref: string; name: string; machine?: string | null; machineType?: string | null; intervalDays?: number | null; intervalHours?: number | null }>;
  jobs: unknown[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  sampleData: boolean;
  counts: { itemTypes: number; machineTypes: number; maintenanceTasks: number; machines: number; items: number };
}

export interface Template extends Omit<TemplateSummary, 'counts'> {
  snapshot: Snapshot;
}
