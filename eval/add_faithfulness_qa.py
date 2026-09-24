"""One-off: adds RAGAS-style metrics — faithfulness_score, answer_relevancy,
context_precision, and (where a reference is available) context_recall — to
each case in an existing eval/results/latest.json (the 20-question qa_testset
report), using the same LLM-judge (eval/judge.py) as the 100-question
hallucination stress test, for consistency across both reports. That report's
own pass/fail already comes from deterministic substring checks (see
eval/evaluate.py grade()); these are a second, complementary signal (are the
answer's claims actually grounded in what was retrieved), not a replacement.

context_recall is computed only for cases whose eval/qa_testset.jsonl entry
has a `must_include_any` field — those phrases are used as a weak reference-
facts proxy (matched back to the original testset by case id, since the
report itself doesn't persist must_include_any). Cases without one (e.g.
tool_claim_consistency cases, which check tool calls, not retrieved facts)
get context_recall=None rather than a fabricated reference.

Doesn't re-run the (expensive) agent calls — question/answer/evidence are
already saved, only the judge call is made.

Usage:
    python -m eval.add_faithfulness_qa
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path

from eval.judge import JUDGE_MODEL, JUDGE_PROVIDER, judge_answer
from src.agent import _format_profile
from src.utils import load_profile

EVAL_DIR = Path(__file__).resolve().parent
REPORT_PATH = EVAL_DIR / "results" / "latest.json"
TESTSET_PATH = EVAL_DIR / "qa_testset.jsonl"


def _load_reference_facts_by_id() -> dict[str, list[str]]:
    facts = {}
    with open(TESTSET_PATH, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            case = json.loads(line)
            must_include_any = case.get("must_include_any")
            if must_include_any:
                facts[case["id"]] = must_include_any
    return facts


def _mean(values: list[float]) -> float | None:
    values = [v for v in values if isinstance(v, (int, float))]
    return round(statistics.mean(values), 4) if values else None


def main():
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    profile_summary = _format_profile(load_profile())
    reference_facts_by_id = _load_reference_facts_by_id()

    faithfulness_scores, relevancy_scores, precision_scores, recall_scores = [], [], [], []
    for i, c in enumerate(report["cases"], start=1):
        run = c["runs"][0] if c.get("runs") else None
        if run is None:
            continue
        print(f"[{i}/{len(report['cases'])}] {c['id']}...", end=" ", flush=True)
        verdict = judge_answer(
            question=c["question"],
            answer=run["answer"],
            evidence=run.get("evidence", ""),
            risk_focus=c["category"],
            profile_summary=profile_summary,
            reference_facts=reference_facts_by_id.get(c["id"]),
        )
        run["faithfulness_score"] = verdict.get("faithfulness_score")
        run["answer_relevancy"] = verdict.get("answer_relevancy")
        run["context_precision"] = verdict.get("context_precision")
        run["context_recall"] = verdict.get("context_recall")
        run["claims"] = verdict.get("claims", [])
        faithfulness_scores.append(run["faithfulness_score"])
        relevancy_scores.append(run["answer_relevancy"])
        precision_scores.append(run["context_precision"])
        recall_scores.append(run["context_recall"])
        print(
            f"faithfulness={run['faithfulness_score']} relevancy={run['answer_relevancy']} "
            f"precision={run['context_precision']} recall={run['context_recall']}"
        )

    report["summary"]["mean_faithfulness_score"] = _mean(faithfulness_scores)
    report["summary"]["mean_answer_relevancy"] = _mean(relevancy_scores)
    report["summary"]["mean_context_precision"] = _mean(precision_scores)
    report["summary"]["mean_context_recall"] = _mean(recall_scores)
    report["summary"]["judge_provider"] = JUDGE_PROVIDER
    report["summary"]["judge_model"] = JUDGE_MODEL

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "=" * 60)
    s = report["summary"]
    for label, key in [
        ("Mean faithfulness score", "mean_faithfulness_score"),
        ("Mean answer relevancy", "mean_answer_relevancy"),
        ("Mean context precision", "mean_context_precision"),
        ("Mean context recall", "mean_context_recall"),
    ]:
        if s.get(key) is not None:
            print(f"{label}: {s[key]:.3f}")
    print(f"\nWrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
