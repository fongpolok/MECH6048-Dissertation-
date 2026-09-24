"""Hallucination-risk stress test against dm_ht_hk_elderly_questions.csv — 100
hand-curated Cantonese questions across 10 categories (Medication Dosage, Drug
Interactions, Diet, Symptom Triage, Monitoring, Complications & Aftercare,
Emergency, Policy/Scheme, Statistics, Myths & Beliefs), each designed to tempt
the model into inventing a specific, unsupported medical claim.

Unlike eval/evaluate.py's qa_testset.jsonl (fixed expected-answer substrings),
these questions have no single correct answer to string-match — grading needs
to judge whether the model's specific claims are supported by the guideline
evidence it retrieved. See eval/judge.py for the LLM-as-judge grader and why
this needs a judge model instead of keyword matching.

Usage:
    python -m eval.hallucination_csv_eval
    python -m eval.hallucination_csv_eval --limit 10                       # smoke test
    python -m eval.hallucination_csv_eval --provider anthropic --model claude-opus-4-8
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import time
from pathlib import Path

from eval.judge import JUDGE_MODEL, JUDGE_PROVIDER, judge_answer
from src.agent import _format_profile, get_medical_agent
from src.utils import load_profile

EVAL_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = EVAL_DIR.parent
DEFAULT_CSV = PROJECT_ROOT / "dm_ht_hk_elderly_questions.csv"
MAX_EVIDENCE_CHARS = 600


def load_questions(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def run_question(agent, profile: dict, row: dict) -> dict:
    start = time.perf_counter()
    result = agent.ask(row["question_zh"], profile)
    latency_ms = round((time.perf_counter() - start) * 1000)

    evidence = result.get("context", "") or ""
    verdict = judge_answer(
        question=row["question_zh"],
        answer=result["answer"],
        evidence=evidence,
        risk_focus=row["hallucination_risk_focus"],
        profile_summary=_format_profile(profile),
    )

    return {
        "id": row["id"],
        "category": row["category"],
        "hallucination_risk_focus": row["hallucination_risk_focus"],
        "question": row["question_zh"],
        "answer": result["answer"],
        "sources": result["sources"],
        "evidence": evidence[:MAX_EVIDENCE_CHARS] + ("…" if len(evidence) > MAX_EVIDENCE_CHARS else ""),
        "claim": verdict.get("claim"),
        "claims": verdict.get("claims", []),
        "faithfulness_score": verdict.get("faithfulness_score"),
        "answer_relevancy": verdict.get("answer_relevancy"),
        "context_precision": verdict.get("context_precision"),
        "context_recall": verdict.get("context_recall"),  # always None here — no reference answers for this stress-test set
        "hallucinated": verdict.get("hallucinated"),
        "reasoning": verdict.get("reasoning"),
        "latency_ms": latency_ms,
    }


def _mean_metric(results: list[dict], key: str) -> float | None:
    values = [r[key] for r in results if isinstance(r.get(key), (int, float))]
    return round(statistics.mean(values), 4) if values else None


def _mean_metric_by_category(results: list[dict], key: str) -> dict[str, float]:
    by_category: dict[str, list[dict]] = {}
    for r in results:
        by_category.setdefault(r["category"], []).append(r)
    return {cat: score for cat, rs in by_category.items() if (score := _mean_metric(rs, key)) is not None}


def summarize(results: list[dict]) -> dict:
    graded = [r for r in results if r["hallucinated"] is not None]
    hallucinated_count = sum(1 for r in graded if r["hallucinated"])
    hallucination_rate = round(hallucinated_count / len(graded), 4) if graded else None

    by_category: dict[str, list[dict]] = {}
    for r in graded:
        by_category.setdefault(r["category"], []).append(r)
    category_rates = {
        cat: round(sum(1 for r in rs if r["hallucinated"]) / len(rs), 4) for cat, rs in by_category.items()
    }

    latencies = sorted(r["latency_ms"] for r in results)
    p95 = latencies[max(0, int(len(latencies) * 0.95) - 1)] if latencies else 0

    return {
        "question_count": len(results),
        "graded_count": len(graded),
        "ungraded_count": len(results) - len(graded),
        "hallucination_rate": hallucination_rate,
        "hallucination_rate_by_category": category_rates,
        "mean_faithfulness_score": _mean_metric(graded, "faithfulness_score"),
        "faithfulness_score_by_category": _mean_metric_by_category(graded, "faithfulness_score"),
        "mean_answer_relevancy": _mean_metric(graded, "answer_relevancy"),
        "answer_relevancy_by_category": _mean_metric_by_category(graded, "answer_relevancy"),
        "mean_context_precision": _mean_metric(graded, "context_precision"),
        "context_precision_by_category": _mean_metric_by_category(graded, "context_precision"),
        # context_recall intentionally omitted — no reference answers for this set (see run_question).
        "mean_latency_ms": round(statistics.mean(latencies)) if latencies else 0,
        "p95_latency_ms": p95,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--limit", type=int, default=None, help="Only run the first N questions (smoke test).")
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--provider", type=str, default=None, help="Override the persisted model selection, e.g. anthropic.")
    parser.add_argument("--model", type=str, default=None, help="Override the persisted model selection, e.g. claude-opus-4-8.")
    args = parser.parse_args()

    rows = load_questions(args.csv)
    if args.limit:
        rows = rows[: args.limit]
    profile = load_profile()
    agent = get_medical_agent(args.provider, args.model)

    print(
        f"Running {len(rows)} hallucination-risk questions from {args.csv.name} "
        f"on {agent.provider}/{agent.model} (judge: {JUDGE_PROVIDER}/{JUDGE_MODEL})...\n"
    )

    results = []
    for i, row in enumerate(rows, start=1):
        print(f"[{i}/{len(rows)}] [{row['category']}] {row['id']}: {row['question_zh'][:40]}...", end=" ", flush=True)
        r = run_question(agent, profile, row)
        results.append(r)
        tag = "HALLUCINATED" if r["hallucinated"] else ("ok" if r["hallucinated"] is False else "JUDGE-ERROR")
        print(f"{tag} ({r['latency_ms']}ms)")

    summary = summarize(results)
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    if summary["hallucination_rate"] is not None:
        print(
            f"Hallucination rate: {summary['hallucination_rate']:.1%}  "
            f"({summary['graded_count']} graded, {summary['ungraded_count']} judge errors)"
        )
    for cat, rate in summary["hallucination_rate_by_category"].items():
        print(f"  {cat:<25} {rate:.0%}")
    if summary["mean_faithfulness_score"] is not None:
        print(f"\nMean faithfulness score:    {summary['mean_faithfulness_score']:.3f}  (supported claims / total claims)")
    if summary["mean_answer_relevancy"] is not None:
        print(f"Mean answer relevancy:      {summary['mean_answer_relevancy']:.3f}")
    if summary["mean_context_precision"] is not None:
        print(f"Mean context precision:     {summary['mean_context_precision']:.3f}")
    print(f"Mean latency: {summary['mean_latency_ms']} ms  |  p95: {summary['p95_latency_ms']} ms")

    report = {
        "csv": str(args.csv),
        "provider": agent.provider,
        "model": agent.model,
        "judge_provider": JUDGE_PROVIDER,
        "judge_model": JUDGE_MODEL,
        "summary": summary,
        "cases": results,
    }

    output_path = args.output or (EVAL_DIR / "results" / "csv_hallucination_latest.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\nFull report written to {output_path}")


if __name__ == "__main__":
    main()
