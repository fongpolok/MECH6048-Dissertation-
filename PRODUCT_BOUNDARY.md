# Product boundary (draft)

What HK ElderGuard AI is allowed to do, what it must refuse or defer, and how
that maps to the carer-facing **安全拒答矩陣** in Settings.

**Status:** engineering draft from the current system prompt (`src/agent.py`),
eval categories, and the local (not yet committed) Settings matrix in
`Figma/Elderly Health AI Agent/src/app/App.tsx`. **Not** clinician-signed and
**not** a regulatory claim.

Related: `HOSTING.md` (where queries run). This file is about *what* the
product may answer, regardless of host.

## In scope

| Allowed | Notes |
|---|---|
| Cantonese-first Q&A on hypertension / type 2 diabetes for HK elderly | Grounded in ingested HK Reference Framework / CDCC / EHS (and related) PDFs via RAG |
| Explain guideline content in plain spoken Cantonese | Short sentences; avoid English jargon |
| Log BP, glucose, HbA1c when the user states values in chat | Only after the corresponding tool actually runs |
| Alert caregiver via configured tool | Never a substitute for 999 on red-flag symptoms |
| OCR of photographed HA documents on-device | Local vision model; see `HOSTING.md` |
| Carer vs elderly-user mode UI | Carer: fuller tabs; User: 主頁/對話 + persistent emergency control |

## Out of scope / must refuse or defer

Aligned with the Settings **安全拒答矩陣** (10 categories). Severity
`critical` = wrong answer can cause immediate physical harm.

| Category | Severity | Policy (product rule) | Typical deferral |
|---|---|---|---|
| Emergency | critical | Always prioritise calling 999 / in-app 緊急求助; do not discuss other topics first | Emergency services |
| Symptom triage (stroke / ACS red flags) | critical | Do not self-grade severity; send to 999 | Emergency services |
| Medication dosage | critical | Never invent or adjust dose (pills, mg, units) | Doctor / pharmacist |
| Drug interactions | high | No comparative efficacy of drugs vs folk remedies | Clinician / pharmacist |
| Monitoring device accuracy | high | No invented device error ranges or thresholds | Lab / clinician |
| Diet (numeric invention) | high | Only guideline-stated diet advice; no fabricated grams/portions | Guideline text or dietitian |
| Complications & aftercare | high | No unverified probabilities; only corpus-backed complication info | Doctor for personal prognosis |
| Statistics | high | Only numbers present in the corpus; no on-the-fly estimates | Official publications |
| Policy / scheme details | high | Unknown clinic/scheme details → say data not available | Official CDCC / HA channels |
| Myths & beliefs | high | Correct myths only from guidelines; no unverified folk cures | Guidelines / clinician |

If the RAG corpus has no answer: say so in Cantonese and suggest asking a
doctor or nurse — **do not invent** drug names, doses, or statistics
(`SYSTEM_PROMPT` rules 2–3).

## Deterministic safety hooks (code)

Beyond the LLM prompt:

- If `alert_caregiver` fires and the model reply omits `999`, the backend
  prepends an explicit 999 / 緊急求助 line (`src/agent.py`).
- Eval harness includes `safety_critical` and `hallucination_trap` cases
  (`eval/`). Treat pass rates as engineering signal, not clinical validation.

## Clinician pathway (current vs needed)

| Today | Still needed for stakeholder sign-off |
|---|---|
| Prompt + matrix + eval traps | Named clinician review of this matrix |
| “Ask doctor/nurse/pharmacist” deferrals | Written validation protocol (scope, population, stop criteria) |
| Carer Settings visibility of refusal policy | Whether pilots require IRB / device-regulatory path (e.g. MDACS) — **out of repo** |

## Relationship to hosting

Product boundary rules apply in **both** local Ollama and cloud-chat demos.
A cloud demo that sends health chat off-box can still obey refusal rules, but
it does **not** satisfy a HK-hosted / on-prem *privacy* requirement — see
`HOSTING.md`.

## Open decisions (Edward / clinician / Elsa)

1. Confirm the 10-category matrix wording for external decks and Lung replies.
2. Whether Settings should **hide** cloud LLM providers in privacy-sensitive builds.
3. Whether medication *logging* remains in-scope for elderly-user mode, or
   carer-only, for pilot scripts.
4. Clinician advisor + timeline (interest window previously discussed as
   roughly Oct–Nov 2026 — confirm outside this repo).

---

*Draft for alignment; hold commit until Edward reviews.*
