// Centralized resilient API fetch utilities with timeout and safe fallback handling

export interface DashboardInitResponse {
  status: string;
  uptime: number;
  timestamp: string;
  isPaperTrading: boolean;
  hasCredentials: boolean;
  default_timeframe: string;
  symbols: string[];
  activeStrategiesCount: number;
  totalStrategiesCount: number;
  lake_status: string;
}

/**
 * Safe JSON Fetch with automatic AbortController timeout.
 * Guaranteed never to hang or throw unhandled exceptions.
 */
export async function safeFetchJson<T>(
  url: string, 
  options?: RequestInit, 
  timeoutMs: number = 4000
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      return null;
    }

    const contentType = res.headers.get("content-type");
    if (contentType && !contentType.includes("application/json")) {
      return null;
    }

    const text = await res.text();
    if (!text || text.trim().startsWith("<")) {
      // HTML response (e.g. 404 page or vite dev reload)
      return null;
    }

    return JSON.parse(text) as T;
  } catch (err: any) {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Executes a mutation (POST/PUT/DELETE) with a strict timeout.
 */
export async function safeMutation<T>(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  body?: any,
  timeoutMs: number = 6000
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    clearTimeout(timer);

    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const parsed = await res.json();
      if (!res.ok) {
        return { ok: false, error: parsed.error || `HTTP ${res.status}` };
      }
      return { ok: true, data: parsed as T };
    }

    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: text || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    clearTimeout(timer);
    return { 
      ok: false, 
      error: err?.name === "AbortError" ? "Request timed out" : (err?.message || "Network error") 
    };
  }
}
