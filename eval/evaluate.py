"""Accuracy / hallucination evaluation harness for the HK ElderGuard AI agent.

Runs a curated set of Cantonese health questions (eval/qa_testset.jsonl) through
the real agent (real Ollama LLM + real Chroma retrieval — no mocking) and checks:

  - grounded_fact       expected numbers/keywords from the HK guideline PDFs appear
  - safety_critical     emergency symptoms (chest pain, stroke signs) trigger "999"
  - hallucination_trap  the model refuses/defers instead of inventing an answer for
                         things outside the guideline corpus (dosages, unrelated
                         conditions)
  - tool_claim_consistency  the model only claims to have logged/notified something
                         if it actually invoked the corresponding tool

Usage:
    python -m eval.evaluate                  # run each case once
    python -m eval.evaluate --repeat 3        # run each case 3x, report consistency
    python -m eval.evaluate --testset path.jsonl --output eval/results/run.json

This requires a running Ollama server with the configured chat + embedding models
pulled, and an ingested Chroma DB (`python -m src.ingest`). It intentionally does
NOT mock the LLM — that's what tests/test_api.py is for.
"""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

from src.agent import get_medical_agent
from src.utils import load_profile

EVAL_DIR = Path(__file__).resolve().parent
DEFAULT_TESTSET = EVAL_DIR / "qa_testset.jsonl"


def load_testset(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def grade(case: dict, result: dict) -> dict:
    answer = result["answer"]
    tool_calls = result.get("tool_calls", [])
    reasons = []
    ok = True

    must_include_any = case.get("must_include_any")
    if must_include_any and not any(n in answer for n in must_include_any):
        ok = False
        reasons.append(f"missing any of required phrases: {must_include_any}")

    for needle in case.get("must_include_all", []):
        if needle not in answer:
            ok = False
            reasons.append(f"missing required phrase: {needle!r}")

    for needle in case.get("must_not_include_any", []):
        if needle in answer:
            ok = False
            reasons.append(f"contains forbidden phrase: {needle!r}")

    expect_tool = case.get("expect_tool_call")
    if expect_tool:
        claim_markers = case.get("claim_markers", [])
        claimed = any(m in answer for m in claim_markers)
        called = expect_tool in tool_calls
        if not called:
            ok = False
            if claimed:
                reasons.append(
                    f"HALLUCINATED ACTION: claimed to have done it but never called tool {expect_tool!r}"
                )
            else:
                reasons.append(f"expected tool {expect_tool!r} was not called")

    return {"pass": ok, "reasons": reasons}


def run_case(agent, profile: dict, case: dict, repeat: int) -> dict:
    runs = []
    for _ in range(repeat):
        result = agent.ask(case["question"], profile)
        verdict = grade(case, result)
        runs.append({"answer": result["answer"], "sources": result["sources"], "tool_calls": result["tool_calls"], **verdict})
    pass_rate = sum(r["pass"] for r in runs) / len(runs)
    return {"id": case["id"], "category": case["category"], "question": case["question"], "pass_rate": pass_rate, "runs": runs}


def summarize(case_results: list[dict]) -> dict:
    by_category: dict[str, list[float]] = {}
    for cr in case_results:
        by_category.setdefault(cr["category"], []).append(cr["pass_rate"])

    overall = statistics.mean(cr["pass_rate"] for cr in case_results) if case_results else 0.0
    category_summary = {cat: round(statistics.mean(rates), 3) for cat, rates in by_category.items()}
    hallucination_categories = ["hallucination_trap", "tool_claim_consistency"]
    hallucination_rates = [r for cr in case_results if cr["category"] in hallucination_categories for r in [cr["pass_rate"]]]
    hallucination_pass_rate = round(statistics.mean(hallucination_rates), 3) if hallucination_rates else None

    return {
        "overall_pass_rate": round(overall, 3),
        "by_category": category_summary,
        "hallucination_related_pass_rate": hallucination_pass_rate,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--testset", type=Path, default=DEFAULT_TESTSET)
    parser.add_argument("--repeat", type=int, default=1, help="Runs per question, to measure consistency under sampling.")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    cases = load_testset(args.testset)
    profile = load_profile()
    agent = get_medical_agent()

    print(f"Running {len(cases)} test cases x{args.repeat} against {args.testset.name}...\n")

    case_results = []
    for case in cases:
        print(f"[{case['category']}] {case['id']}: {case['question']}")
        cr = run_case(agent, profile, case, args.repeat)
        case_results.append(cr)
        status = "PASS" if cr["pass_rate"] == 1.0 else ("FLAKY" if cr["pass_rate"] > 0 else "FAIL")
        print(f"  -> {status} (pass_rate={cr['pass_rate']:.2f})")
        for run in cr["runs"]:
            if not run["pass"]:
                for reason in run["reasons"]:
                    print(f"     ! {reason}")
        print()

    summary = summarize(case_results)
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Overall pass rate: {summary['overall_pass_rate']:.0%}")
    for cat, rate in summary["by_category"].items():
        print(f"  {cat:<25} {rate:.0%}")
    if summary["hallucination_related_pass_rate"] is not None:
        print(f"\nHallucination-related pass rate: {summary['hallucination_related_pass_rate']:.0%}")
        print("(hallucination_trap + tool_claim_consistency categories combined)")

    report = {
        "testset": str(args.testset),
        "repeat": args.repeat,
        "summary": summary,
        "cases": case_results,
    }

    output_path = args.output
    if output_path is None:
        output_path = EVAL_DIR / "results" / "latest.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\nFull report written to {output_path}")


if __name__ == "__main__":
    main()
