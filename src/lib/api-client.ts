import type {
  ActivityEvent,
  Expense,
  Group,
  GroupMember,
  Notification,
  Settlement,
  SplitMethod,
} from "@/src/core/models/types";

type ApiErrorBody = { error?: string; message?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      // Proves the request came from this app's own scripts (see proxy.ts).
      "X-Noirly-CSRF": "1",
      ...(init?.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    throw new Error(data.message || data.error || "Request failed");
  }
  return data;
}

export type CreateExpenseBody = {
  amount: number;
  currency?: string;
  fxRateToBase?: number;
  description: string;
  date: string;
  category?: "food" | "travel" | "rent" | "utilities" | "other" | null;
  receiptUrl?: string | null;
  paidByUserId?: string;
  payers?: Array<{ userId: string; amountPaid: number }>;
  splitMethod: SplitMethod;
  participantIds: string[];
  allocations?: Array<{
    userId: string;
    amountOwed?: number;
    percentage?: number;
    shares?: number;
  }>;
  isRecurring?: boolean;
  recurrence?: {
    frequency: "weekly" | "monthly";
    interval: number;
    endAt?: string | null;
  } | null;
};

export type BalancesResponse = {
  baseCurrency: string;
  yourNet: number;
  nets: Array<{
    userId: string;
    netInBase: number;
    displayName: string;
  }>;
  simplified: Array<{
    fromUserId: string;
    toUserId: string;
    amountInBase: number;
    fromDisplayName: string;
    toDisplayName: string;
  }>;
};

export const api = {
  me() {
    return request<{
      user: {
        id: string;
        email: string;
        displayName: string;
        avatarUrl: string | null;
        preferredCurrency: string;
        identitySub: string;
      };
    }>("/api/me");
  },
  listGroups() {
    return request<{ groups: Group[] }>("/api/groups");
  },
  createGroup(body: {
    name: string;
    icon?: string | null;
    color?: string | null;
    baseCurrency?: string;
  }) {
    return request<{ group: Group }>("/api/groups", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  getGroup(groupId: string) {
    return request<{ group: Group }>(`/api/groups/${groupId}`);
  },
  updateGroup(
    groupId: string,
    body: {
      name?: string;
      icon?: string | null;
      color?: string | null;
      baseCurrency?: string;
    },
  ) {
    return request<{ group: Group }>(`/api/groups/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  archiveGroup(groupId: string) {
    return request<{ group: Group }>(`/api/groups/${groupId}/archive`, {
      method: "POST",
    });
  },
  deleteGroup(groupId: string) {
    return request<{ ok: boolean }>(`/api/groups/${groupId}`, {
      method: "DELETE",
    });
  },
  leaveGroup(groupId: string) {
    return request<{ ok: boolean }>(`/api/groups/${groupId}/leave`, {
      method: "DELETE",
    });
  },
  listMembers(groupId: string) {
    return request<{ members: GroupMember[] }>(
      `/api/groups/${groupId}/members`,
    );
  },
  createInvite(groupId: string, body: { email?: string | null } = {}) {
    return request<{
      invite: {
        id: string;
        token: string;
        url: string;
        mailto: string | null;
        expiresAt: string;
      };
    }>(`/api/groups/${groupId}/invites`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  getInvite(token: string) {
    return request<{
      group: Group;
      email: string | null;
      expiresAt: string;
      acceptedAt: string | null;
    }>(`/api/invites/${token}`);
  },
  acceptInvite(token: string) {
    return request<{ groupId: string; group: Group }>(
      `/api/invites/${token}`,
      { method: "POST" },
    );
  },
  listExpenses(
    groupId: string,
    query: { q?: string; category?: string } = {},
  ) {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.category) params.set("category", query.category);
    const qs = params.toString();
    return request<{ expenses: Expense[] }>(
      `/api/groups/${groupId}/expenses${qs ? `?${qs}` : ""}`,
    );
  },
  getExpense(groupId: string, expenseId: string) {
    return request<{ expense: Expense }>(
      `/api/groups/${groupId}/expenses/${expenseId}`,
    );
  },
  createExpense(groupId: string, body: CreateExpenseBody) {
    return request<{ expense: Expense }>(`/api/groups/${groupId}/expenses`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  updateExpense(
    groupId: string,
    expenseId: string,
    body: Partial<CreateExpenseBody>,
  ) {
    return request<{ expense: Expense }>(
      `/api/groups/${groupId}/expenses/${expenseId}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    );
  },
  deleteExpense(groupId: string, expenseId: string) {
    return request<{ ok: boolean }>(
      `/api/groups/${groupId}/expenses/${expenseId}`,
      { method: "DELETE" },
    );
  },
  getBalances(groupId: string) {
    return request<BalancesResponse>(`/api/groups/${groupId}/balances`);
  },
  listSettlements(groupId: string) {
    return request<{ settlements: Settlement[] }>(
      `/api/groups/${groupId}/settlements`,
    );
  },
  createSettlement(
    groupId: string,
    body: {
      fromUserId: string;
      toUserId: string;
      amount: number;
      note?: string | null;
    },
  ) {
    return request<{ settlement: Settlement }>(
      `/api/groups/${groupId}/settlements`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  },
  listActivity(groupId: string) {
    return request<{
      items: Array<ActivityEvent & { actorDisplayName: string }>;
    }>(`/api/groups/${groupId}/activity`);
  },
  exportCsvUrl(groupId: string) {
    return `/api/groups/${groupId}/export`;
  },
  getReport(groupId: string) {
    return request<{
      baseCurrency: string;
      expenseCount: number;
      totalInBase: number;
      byCategory: Array<{ category: string; amountInBase: number }>;
      recent: Expense[];
    }>(`/api/groups/${groupId}/reports`);
  },
  dashboardBalances() {
    return request<{
      mixed: boolean;
      currency: string | null;
      owedToYou: number | null;
      youOwe: number | null;
      byCurrency: Record<
        string,
        {
          owedToYou: number;
          youOwe: number;
          groups: Array<{ groupId: string; name: string; net: number }>;
        }
      >;
    }>("/api/dashboard/balances");
  },
  listNotifications() {
    return request<{ items: Notification[]; unreadCount: number }>(
      "/api/notifications",
    );
  },
  markNotificationsRead(body: { ids?: string[]; all?: boolean }) {
    return request<{ ok: boolean }>("/api/notifications", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  uploadReceipt(groupId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return request<{ url: string }>(`/api/groups/${groupId}/receipts`, {
      method: "POST",
      body: form,
    });
  },
};
