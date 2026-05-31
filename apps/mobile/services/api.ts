import axios from 'axios';
import {
  Escrow,
  EscrowFilters,
  EscrowListResponse,
  CreateEscrowPayload,
  ReleaseMilestonePayload,
} from '../types/escrow';
import { withRetry } from '../utils/retry';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  // Token would come from secure storage in production
  const token = (global as Record<string, unknown>).__authToken as string | undefined;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const escrowApi = {
  /** #314 – list escrows with status filter + pagination (auto-retry on testnet failures) */
  list: async (filters: EscrowFilters = {}): Promise<EscrowListResponse> => {
    return withRetry(async () => {
      const params: Record<string, string | number> = {
        page: filters.page ?? 1,
        limit: filters.limit ?? 20,
      };
      if (filters.status && filters.status !== 'all') params.status = filters.status;
      if (filters.search) params.search = filters.search;

      const { data } = await api.get<EscrowListResponse>('/api/escrows', { params });
      return data;
    }, { maxRetries: 2 }); // Lighter retry for list calls to avoid stale data
  },

  /** #315 – get single escrow with milestones, parties, events (auto-retry) */
  getById: async (id: string): Promise<Escrow> => {
    return withRetry(async () => {
      const { data } = await api.get<Escrow>(`/api/escrows/${id}`);
      return data;
    }, { maxRetries: 3 });
  },

  /** #316 – create escrow (no auto-retry — user explicitly triggers this) */
  create: async (payload: CreateEscrowPayload): Promise<Escrow> => {
    const { data } = await api.post<Escrow>('/api/escrows', payload);
    return data;
  },

  /** #317 – release a milestone (no auto-retry — tx-sensitive, user controls retry) */
  releaseMilestone: async (payload: ReleaseMilestonePayload): Promise<{ txHash: string }> => {
    const { data } = await api.post<{ txHash: string }>(
      `/api/escrows/${payload.escrowId}/milestones/${payload.milestoneId}/release`,
    );
    return data;
  },

  /** #317 – poll transaction status (auto-retry with longer backoff) */
  getTxStatus: async (txHash: string): Promise<{ status: string; confirmed: boolean }> => {
    return withRetry(async () => {
      const { data } = await api.get<{ status: string; confirmed: boolean }>(
        `/api/transactions/${txHash}/status`,
      );
      return data;
    }, { maxRetries: 2, initialDelayMs: 2000 });
  },
};
