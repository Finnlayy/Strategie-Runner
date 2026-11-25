/**
 * Client for the QuantJourney backtesting workflow.
 *
 * Long-running research calls (walk-forward, optimisation) use generous
 * timeouts and surface backend error payloads verbatim so the studio can show
 * actionable failures instead of a generic network error.
 */

import {
  ArenaResult,
  QjEngineCapabilities,
  QjEnrichedBacktestResult,
  QjOptimizationResult,
  QjRunSummary,
  QjStressResult,
  QjWalkForwardResult,
} from '../types';

const BASE = '/api/backtest';

export class QjApiError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status = 0, detail?: string) {
    super(message);
    this.name = 'QjApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let payload: any = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const message = payload?.error || payload?.detail || response.statusText || 'Request failed';
      throw new QjApiError(String(message), response.status, payload?.detail);
    }
    if (!payload) {
      throw new QjApiError('Backtest service returned an empty response', response.status);
    }
    return payload as T;
  } catch (error: any) {
    if (error instanceof QjApiError) throw error;
    if (error?.name === 'AbortError') {
      throw new QjApiError(`Backtest request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new QjApiError(error?.message || 'Unable to reach the backtest service');
  } finally {
    clearTimeout(timer);
  }
}

export async function getQjCapabilities(force = false): Promise<QjEngineCapabilities> {
  return request<QjEngineCapabilities>(`/engines${force ? '?refresh=1' : ''}`, {}, 45_000);
}

export async function runQjBacktest(payload: Record<string, any>): Promise<QjEnrichedBacktestResult> {
  return request<QjEnrichedBacktestResult>(
    '/run',
    { method: 'POST', body: JSON.stringify({ ...payload, engine: 'quantjourney' }) },
    300_000
  );
}

export async function runQjWalkForward(payload: Record<string, any>): Promise<QjWalkForwardResult> {
  return request<QjWalkForwardResult>(
    '/walkforward',
    { method: 'POST', body: JSON.stringify(payload) },
    900_000
  );
}

export async function runQjOptimization(payload: Record<string, any>): Promise<QjOptimizationResult> {
  return request<QjOptimizationResult>(
    '/optimize',
    { method: 'POST', body: JSON.stringify(payload) },
    900_000
  );
}

export async function runQjStress(payload: Record<string, any>): Promise<QjStressResult> {
  return request<QjStressResult>(
    '/stress',
    { method: 'POST', body: JSON.stringify(payload) },
    300_000
  );
}

export async function runQjArena(payload: Record<string, any>): Promise<ArenaResult> {
  return request<ArenaResult>(
    '/arena',
    { method: 'POST', body: JSON.stringify(payload) },
    300_000
  );
}

export async function listQjRuns(limit = 25, kind?: string): Promise<QjRunSummary[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (kind) query.set('kind', kind);
  const payload = await request<{ runs: QjRunSummary[] }>(`/runs?${query.toString()}`, {}, 45_000);
  return payload.runs || [];
}

export async function getQjRun(
  runId: string,
  includeResult = true
): Promise<{ runId: string; summary: QjRunSummary; payload?: any; result?: any; manifest?: any }> {
  return request(`/runs/${encodeURIComponent(runId)}?includeResult=${includeResult ? 'true' : 'false'}`, {}, 60_000);
}

export async function deleteQjRun(runId: string): Promise<{ runId: string; deleted: boolean }> {
  return request(
    `/runs/${encodeURIComponent(runId)}`,
    { method: 'DELETE' },
    45_000
  );
}

export async function compareQjRuns(runIds: string[]): Promise<any> {
  return request('/compare', { method: 'POST', body: JSON.stringify({ runIds }) }, 90_000);
}

export function qjArtifactUrl(runId: string, name: string): string {
  return `${BASE}/runs/${encodeURIComponent(runId)}/artifact/${encodeURIComponent(name)}`;
}
