"""One-off: re-judges an existing eval/results/csv_hallucination_latest.json
report with the current eval/judge.py, without re-running the (expensive)
agent calls — the question/answer/evidence are already saved, only the judge
verdict needs recomputing. Used after judge.py methodology changes (e.g. the
profile-visibility fix, or adding the RAGAS-style faithfulness_score) that
should be reflected without paying for another ~90-minute agent run.

Note: the local judge model is noisy run-to-run even at temperature=0 (no
fixed seed) — expect the hallucination rate to shift somewhat between
regrades even with no prompt changes. See eval/export_excel.py's Summary
sheet caveats.

Usage:
    python -m eval.regrade_hallucination
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path

from eval.hallucination_csv_eval import summarize
from eval.judge import JUDGE_MODEL, JUDGE_PROVIDER, judge_answer
from src.agent import _format_profile
from src.utils import load_profile

EVAL_DIR = Path(__file__).resolve().parent
REPORT_PATH = EVAL_DIR / "results" / "csv_hallucination_latest.json"


def main():
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    profile_summary = _format_profile(load_profile())

    for i, c in enumerate(report["cases"], start=1):
        print(f"[{i}/{len(report['cases'])}] {c['id']}...", end=" ", flush=True)
        verdict = judge_answer(
            question=c["question"],
            answer=c["answer"],
            evidence=c["evidence"],
            risk_focus=c["hallucination_risk_focus"],
            profile_summary=profile_summary,
        )
        c["claim"] = verdict.get("claim")
        c["claims"] = verdict.get("claims", [])
        c["faithfulness_score"] = verdict.get("faithfulness_score")
        c["answer_relevancy"] = verdict.get("answer_relevancy")
        c["context_precision"] = verdict.get("context_precision")
        c["context_recall"] = verdict.get("context_recall")
        c["hallucinated"] = verdict.get("hallucinated")
        c["reasoning"] = verdict.get("reasoning")
        print("HALLUCINATED" if c["hallucinated"] else ("ok" if c["hallucinated"] is False else "JUDGE-ERROR"))

    report["judge_provider"] = JUDGE_PROVIDER
    report["judge_model"] = JUDGE_MODEL
    report["summary"] = summarize(report["cases"])

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    s = report["summary"]
    print("\n" + "=" * 60)
    print("SUMMARY (re-graded)")
    print("=" * 60)
    print(f"Hallucination rate: {s['hallucination_rate']:.1%} ({s['graded_count']} graded, {s['ungraded_count']} judge errors)")
    for cat, rate in s["hallucination_rate_by_category"].items():
        print(f"  {cat:<25} {rate:.0%}")
    if s["mean_faithfulness_score"] is not None:
        print(f"\nMean faithfulness score: {s['mean_faithfulness_score']:.3f}")
    if s["mean_answer_relevancy"] is not None:
        print(f"Mean answer relevancy:   {s['mean_answer_relevancy']:.3f}")
    if s["mean_context_precision"] is not None:
        print(f"Mean context precision:  {s['mean_context_precision']:.3f}")


if __name__ == "__main__":
    main()
