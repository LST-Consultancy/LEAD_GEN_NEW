export type ShellCounters = {
  inbox: number;
  queue: number;
  approvals: number;
  notifications: number;
  autopilot: number;
};

export type ShellWorkspace = {
  id: string;
  name: string;
  slug: string;
  roleName: string;
};

export type ShellUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};

export type PointsSummary = {
  balance: number;
  monthlyAllowance: number;
  averagePerDay: number;
  daysRemaining: number | null;
  planName: string;
};
