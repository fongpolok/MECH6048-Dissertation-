// Client for the FastAPI backend in src/api.py (see docker-compose.yml / README
// for how it's deployed). All calls fail soft (throw) so callers can decide
// whether to fall back to offline/demo behavior — this is an elderly health
// app, so a flaky network must never block the emergency (SOS) UI.

export const API_BASE_URL: string =
  (import.meta as any).env?.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`API ${path} failed: ${res.status} ${detail}`);
  }
  return res.json() as Promise<T>;
}

export type ChatTurn = { role: "user" | "agent"; text: string };

export type ChatResponse = { reply: string; sources: string[] };

export function sendChatMessage(message: string, history: ChatTurn[]): Promise<ChatResponse> {
  return request<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
}

export function logMedication(name: string, taken: boolean): Promise<unknown> {
  return request("/api/medications/log", {
    method: "POST",
    body: JSON.stringify({ name, taken }),
  });
}

export function submitWellness(answers: Record<string, string>): Promise<unknown> {
  return request("/api/wellness", {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export function alertCaregiver(message: string): Promise<unknown> {
  return request("/api/alert", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function checkHealth(): Promise<{ status: string }> {
  return request("/api/health");
}
