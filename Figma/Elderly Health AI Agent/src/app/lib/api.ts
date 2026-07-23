// Client for the FastAPI backend in src/api.py (see docker-compose.yml / README
// for how it's deployed). All calls fail soft (throw) so callers can decide
// whether to fall back to offline/demo behavior — this is an elderly health
// app, so a flaky network must never block the emergency (SOS) UI.

// Defaults to whatever host the page itself was loaded from, on port 8000 —
// this makes "open the app from an iPhone on the same Wi-Fi" work without any
// rebuild: the phone loads http://<mac-lan-ip>:5173, so it also talks to
// http://<mac-lan-ip>:8000 automatically. VITE_API_URL still wins when set
// (Docker/production deploys, where frontend and backend aren't on the same
// LAN-reachable host).
function defaultApiBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.hostname) {
    return `http://${window.location.hostname}:8000`;
  }
  return "http://localhost:8000";
}

export const API_BASE_URL: string =
  (import.meta as any).env?.VITE_API_URL ?? defaultApiBaseUrl();

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

export type ChatResponse = { reply: string; sources: string[]; is_emergency: boolean };

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

// ── Health records (血壓/血糖/HbA1c daily tracking in the 記錄 tab) ─────────────
// `id` is set once the backend has persisted the entry — used to tell "new
// entry" (POST) apart from "amend existing entry" (PATCH) in the UI.

export type BPRecord = { id?: string; date: string; sys: number; dia: number };
export type GlucoseRecord = { id?: string; date: string; value: number };
export type HbA1cRecord = { id?: string; date: string; value: number };

export function logBPRecord(entry: BPRecord): Promise<BPRecord> {
  return request<BPRecord>("/api/records/bp", { method: "POST", body: JSON.stringify(entry) });
}

export function getBPRecords(): Promise<BPRecord[]> {
  return request<BPRecord[]>("/api/records/bp");
}

export function amendBPRecord(id: string, patch: Partial<BPRecord>): Promise<BPRecord> {
  return request<BPRecord>(`/api/records/bp/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function logGlucoseRecord(entry: GlucoseRecord): Promise<GlucoseRecord> {
  return request<GlucoseRecord>("/api/records/glucose", { method: "POST", body: JSON.stringify(entry) });
}

export function getGlucoseRecords(): Promise<GlucoseRecord[]> {
  return request<GlucoseRecord[]>("/api/records/glucose");
}

export function amendGlucoseRecord(id: string, patch: Partial<GlucoseRecord>): Promise<GlucoseRecord> {
  return request<GlucoseRecord>(`/api/records/glucose/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function logHbA1cRecord(entry: HbA1cRecord): Promise<HbA1cRecord> {
  return request<HbA1cRecord>("/api/records/hba1c", { method: "POST", body: JSON.stringify(entry) });
}

export function getHbA1cRecords(): Promise<HbA1cRecord[]> {
  return request<HbA1cRecord[]>("/api/records/hba1c");
}

export function amendHbA1cRecord(id: string, patch: Partial<HbA1cRecord>): Promise<HbA1cRecord> {
  return request<HbA1cRecord>(`/api/records/hba1c/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// ── OCR document scan (掃描 tab) ────────────────────────────────────────────────

export type ScannedDoc = {
  id: string;
  title: string;
  patient: string;
  pid: string;
  issued: string;
  sections: { label: string; items: string[] }[];
};

// Not routed through request<T>() — that helper forces
// Content-Type: application/json, but a multipart upload needs the browser to
// set its own Content-Type with the multipart boundary.
export async function scanDocument(file: File | Blob): Promise<ScannedDoc> {
  const formData = new FormData();
  formData.append("file", file, file instanceof File ? file.name : "scan.jpg");
  const res = await fetch(`${API_BASE_URL}/api/ocr/scan`, { method: "POST", body: formData });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`API /api/ocr/scan failed: ${res.status} ${detail}`);
  }
  return res.json() as Promise<ScannedDoc>;
}

export function getScans(): Promise<ScannedDoc[]> {
  return request<ScannedDoc[]>("/api/scans");
}

// Mirrors the report shape written by eval/evaluate.py (src/api.py just reads
// the JSON file straight through).
export type EvalCaseRun = {
  answer: string;
  sources: string[];
  tool_calls: string[];
  pass: boolean;
  reasons: string[];
};

export type EvalCase = {
  id: string;
  category: string;
  question: string;
  pass_rate: number;
  runs: EvalCaseRun[];
};

export type EvalSummary = {
  overall_pass_rate: number;
  by_category: Record<string, number>;
  hallucination_related_pass_rate: number | null;
};

export type EvalReport = {
  testset: string;
  repeat: number;
  summary: EvalSummary;
  cases: EvalCase[];
};

export function getEvalReport(): Promise<EvalReport> {
  return request<EvalReport>("/api/eval/latest");
}
