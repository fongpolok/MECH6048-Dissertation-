"""Compiles all three eval reports into one formatted Excel workbook for
offline review / dissertation write-up:

  - eval/results/latest.json               20-question grounded_fact / safety_critical /
                                            hallucination_trap / tool_claim_consistency set
  - eval/results/csv_hallucination_latest.json   100-question hallucination-risk stress test
  - eval/results/ocr_latest.json           OCR Character Error Rate (6 documents)

Each becomes its own sheet, plus a Summary sheet with the headline numbers.
Missing reports are skipped (with a note on the Summary sheet) rather than
failing the whole export, since not every report may have been (re-)run yet.

Usage:
    python -m eval.export_excel
    python -m eval.export_excel --output eval/results/my_report.xlsx
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pandas as pd
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

# Excel/XML forbids most C0 control characters (allows only tab \x09, LF \x0A,
# CR \x0D) — PDF-extracted guideline text occasionally carries stray control
# bytes (e.g. form feed) that openpyxl rejects outright, so strip them before
# writing rather than letting the whole export crash on one bad cell.
_ILLEGAL_XML_CHARS = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _sanitize(value):
    if isinstance(value, str):
        return _ILLEGAL_XML_CHARS.sub("", value)
    return value

EVAL_DIR = Path(__file__).resolve().parent
RESULTS_DIR = EVAL_DIR / "results"

HEADER_FILL = PatternFill(start_color="FF1F2A44", end_color="FF1F2A44", fill_type="solid")
HEADER_FONT = Font(color="FFFFFFFF", bold=True)
PASS_FILL = PatternFill(start_color="FFDFF5E1", end_color="FFDFF5E1", fill_type="solid")
FAIL_FILL = PatternFill(start_color="FFFBE0DE", end_color="FFFBE0DE", fill_type="solid")
NEUTRAL_FILL = PatternFill(start_color="FFF2F2F2", end_color="FFF2F2F2", fill_type="solid")

# (excel column letter -> width) overrides for long free-text columns, applied
# per-sheet by column name below.
WIDE_COLUMNS = {"question", "answer", "claim", "evidence", "reasoning", "reference", "hypothesis", "reasons"}


def _load(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _style_sheet(ws, df: pd.DataFrame, color_col: str | None = None, color_true_fill=FAIL_FILL, color_false_fill=PASS_FILL):
    ws.freeze_panes = "A2"
    for col_idx, col_name in enumerate(df.columns, start=1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        width = 48 if col_name in WIDE_COLUMNS else 16
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    color_col_idx = list(df.columns).index(color_col) + 1 if color_col and color_col in df.columns else None
    for row_idx in range(2, ws.max_row + 1):
        for col_idx in range(1, ws.max_column + 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.alignment = Alignment(vertical="top", wrap_text=col_idx in [i + 1 for i, c in enumerate(df.columns) if c in WIDE_COLUMNS])
        if color_col_idx:
            value = ws.cell(row=row_idx, column=color_col_idx).value
            fill = color_true_fill if value in (True, "True", "TRUE") else (color_false_fill if value in (False, "False", "FALSE") else NEUTRAL_FILL)
            for col_idx in range(1, ws.max_column + 1):
                ws.cell(row=row_idx, column=col_idx).fill = fill
    ws.row_dimensions[1].height = 32


def build_qa_sheet(report: dict) -> pd.DataFrame:
    rows = []
    for c in report["cases"]:
        run = c["runs"][0] if c.get("runs") else {}
        rows.append(
            {
                "id": c["id"],
                "category": c["category"],
                "question": c["question"],
                "pass": run.get("pass"),
                "pass_rate": c["pass_rate"],
                "faithfulness_score": run.get("faithfulness_score"),
                "answer_relevancy": run.get("answer_relevancy"),
                "context_precision": run.get("context_precision"),
                "context_recall": run.get("context_recall"),
                "latency_ms": c.get("mean_latency_ms"),
                "claim": run.get("claim"),
                "evidence": run.get("evidence"),
                "reasoning": run.get("reasoning"),
                "reasons": "; ".join(run.get("reasons", [])),
            }
        )
    return pd.DataFrame(rows)


def build_hallucination_sheet(report: dict) -> pd.DataFrame:
    rows = []
    for c in report["cases"]:
        rows.append(
            {
                "id": c["id"],
                "category": c["category"],
                "hallucination_risk_focus": c["hallucination_risk_focus"],
                "question": c["question"],
                "answer": c["answer"],
                "hallucinated": c["hallucinated"],
                "faithfulness_score": c.get("faithfulness_score"),
                "answer_relevancy": c.get("answer_relevancy"),
                "context_precision": c.get("context_precision"),
                "context_recall": c.get("context_recall"),
                "latency_ms": c["latency_ms"],
                "claim": c["claim"],
                "evidence": c["evidence"],
                "reasoning": c["reasoning"],
            }
        )
    return pd.DataFrame(rows)


def build_ocr_sheet(report: dict) -> pd.DataFrame:
    rows = []
    for c in report["cases"]:
        rows.append(
            {
                "id": c["id"],
                "label": c["label"],
                "cer": c["cer"],
                "accuracy": c["accuracy"],
                "reference": c["reference"],
                "hypothesis": c["hypothesis"],
            }
        )
    return pd.DataFrame(rows)


def build_summary_rows(qa: dict | None, hallucination: dict | None, ocr: dict | None) -> pd.DataFrame:
    rows = [
        {
            "metric": "ℹ note — faithfulness score",
            "value": (
                "RAGAS-style metric (see eval/judge.py): the judge LLM decomposes each answer into its "
                "individual factual claims (dosages, statistics, named drugs — not generic safety advice like "
                "\"see a doctor\"), checks each against the retrieved evidence + patient profile, and the score "
                "is (# supported claims) / (# total claims). 1.0 = every specific claim made was grounded; an "
                "answer with no factual claims at all (a pure deferral) also scores 1.0. Distinct from the "
                "'hallucinated' flag, which is just faithfulness_score < 1.0 — the score shows *how much* of an "
                "answer was ungrounded, not just whether any of it was."
            ),
        },
        {
            "metric": "ℹ note — answer relevancy",
            "value": (
                "Does the answer actually address the question asked (0.0-1.0), independent of whether it's "
                "grounded. SIMPLIFIED implementation: standard RAGAS generates several reverse-engineered "
                "questions from the answer and measures embedding similarity to the original question — this "
                "project's judge instead scores relevancy directly in the same single call as everything else, "
                "to avoid quadrupling an already multi-hour local-model eval with extra embedding-pipeline calls. "
                "Report this distinction explicitly if citing the metric academically."
            ),
        },
        {
            "metric": "ℹ note — context precision",
            "value": (
                "What fraction of the retrieved evidence chunks (split on the '[來源: ...]' source markers) "
                "were actually relevant to the question (0.0-1.0). APPROXIMATION: standard RAGAS uses a "
                "rank-weighted precision over per-chunk relevance; this implementation uses a flat "
                "(non-rank-weighted) precision = relevant chunks / total chunks, judged in the same call."
            ),
        },
        {
            "metric": "ℹ note — context recall",
            "value": (
                "Did the retrieved evidence contain the information needed to answer correctly (0.0-1.0). "
                "Requires a reference/ground-truth answer, so it is ONLY computed for the 20-question QA test "
                "(using each case's must_include_any phrases as a weak reference-facts proxy) — the 100-question "
                "hallucination stress-test set has no reference answers by design (that's what makes it a "
                "hallucination trap rather than a fact-check), so context_recall is left blank there rather than "
                "fabricated."
            ),
        },
    ]
    if qa:
        s = qa["summary"]
        rows += [
            {"metric": "QA test — model", "value": f"{qa.get('provider', '?')}/{qa.get('model', '?')}"},
            {"metric": "QA test — question count", "value": len(qa["cases"])},
            {"metric": "QA test — overall pass rate", "value": s["overall_pass_rate"]},
            {"metric": "QA test — hallucination-related pass rate", "value": s.get("hallucination_related_pass_rate")},
            {"metric": "QA test — mean faithfulness score", "value": s.get("mean_faithfulness_score")},
            {"metric": "QA test — mean answer relevancy", "value": s.get("mean_answer_relevancy")},
            {"metric": "QA test — mean context precision", "value": s.get("mean_context_precision")},
            {"metric": "QA test — mean context recall", "value": s.get("mean_context_recall")},
            {"metric": "QA test — mean latency (ms)", "value": s.get("mean_latency_ms")},
        ]
        for cat, rate in s["by_category"].items():
            rows.append({"metric": f"QA test — {cat} pass rate", "value": rate})
    else:
        rows.append({"metric": "QA test (eval/results/latest.json)", "value": "NOT FOUND — run `python -m eval.evaluate`"})

    if hallucination:
        s = hallucination["summary"]
        rows += [
            {"metric": "Hallucination stress test — model", "value": f"{hallucination.get('provider', '?')}/{hallucination.get('model', '?')}"},
            {"metric": "Hallucination stress test — judge", "value": f"{hallucination.get('judge_provider', '?')}/{hallucination.get('judge_model', '?')}"},
            {"metric": "Hallucination stress test — question count", "value": s["question_count"]},
            {"metric": "Hallucination stress test — graded / judge errors", "value": f"{s['graded_count']} / {s['ungraded_count']}"},
            {"metric": "Hallucination stress test — hallucination rate", "value": s["hallucination_rate"]},
            {"metric": "Hallucination stress test — mean faithfulness score", "value": s.get("mean_faithfulness_score")},
            {"metric": "Hallucination stress test — mean answer relevancy", "value": s.get("mean_answer_relevancy")},
            {"metric": "Hallucination stress test — mean context precision", "value": s.get("mean_context_precision")},
            {"metric": "Hallucination stress test — mean context recall", "value": "N/A — no reference answers for this set (see note above)"},
            {"metric": "Hallucination stress test — mean latency (ms)", "value": s.get("mean_latency_ms")},
            {"metric": "Hallucination stress test — p95 latency (ms)", "value": s.get("p95_latency_ms")},
        ]
        for cat, rate in s["hallucination_rate_by_category"].items():
            rows.append({"metric": f"Hallucination stress test — {cat} rate", "value": rate})
        for cat, score in s.get("faithfulness_score_by_category", {}).items():
            rows.append({"metric": f"Hallucination stress test — {cat} faithfulness score", "value": score})
        for cat, score in s.get("answer_relevancy_by_category", {}).items():
            rows.append({"metric": f"Hallucination stress test — {cat} answer relevancy", "value": score})
        for cat, score in s.get("context_precision_by_category", {}).items():
            rows.append({"metric": f"Hallucination stress test — {cat} context precision", "value": score})
        rows += [
            {"metric": "⚠ CAVEAT — evidence completeness", "value": "The 'evidence' column only captures the agent's initial unconditional RAG retrieval, not any extra lookups made mid-reasoning via its search_hk_guidelines tool call. A few 'hallucinated' verdicts (e.g. a correctly-cited 25x amputation-risk stat, correctly-cited BP targets) reflect this gap, not the model inventing facts — the cited fact exists elsewhere in the corpus but wasn't captured in this run's evidence snapshot."},
            {"metric": "⚠ CAVEAT — judge stability", "value": f"Judge is the local {hallucination.get('judge_provider','?')}/{hallucination.get('judge_model','?')} model at temperature=0 with no fixed seed. Re-grading the same saved answers twice produced materially different verdicts on ~10 of 100 cases (5.0% -> 13.1% overall rate) — this is real run-to-run judge noise, not just the profile-awareness fix taking effect. Treat this rate as an estimate with meaningful variance, not a precise figure, until a stronger independent judge (e.g. Claude, once configured) is used."},
        ]
    else:
        rows.append({"metric": "Hallucination stress test (eval/results/csv_hallucination_latest.json)", "value": "NOT FOUND — run `python -m eval.hallucination_csv_eval`"})

    if ocr:
        s = ocr["summary"]
        rows += [
            {"metric": "OCR CER — vision model", "value": ocr.get("model", "?")},
            {"metric": "OCR CER — document count", "value": s["case_count"]},
            {"metric": "OCR CER — mean CER", "value": s["mean_cer"]},
            {"metric": "OCR CER — mean accuracy", "value": s["mean_accuracy"]},
        ]
    else:
        rows.append({"metric": "OCR CER (eval/results/ocr_latest.json)", "value": "NOT FOUND — run `python -m eval.ocr_cer`"})

    return pd.DataFrame(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=RESULTS_DIR / "eval_report.xlsx")
    args = parser.parse_args()

    qa = _load(RESULTS_DIR / "latest.json")
    hallucination = _load(RESULTS_DIR / "csv_hallucination_latest.json")
    ocr = _load(RESULTS_DIR / "ocr_latest.json")

    summary_df = build_summary_rows(qa, hallucination, ocr).map(_sanitize)
    qa_df = build_qa_sheet(qa).map(_sanitize) if qa else None
    hallucination_df = build_hallucination_sheet(hallucination).map(_sanitize) if hallucination else None
    ocr_df = build_ocr_sheet(ocr).map(_sanitize) if ocr else None

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(args.output, engine="openpyxl") as writer:
        summary_df.to_excel(writer, sheet_name="Summary", index=False)
        if qa_df is not None:
            qa_df.to_excel(writer, sheet_name="QA_Test_20Q", index=False)
        if hallucination_df is not None:
            hallucination_df.to_excel(writer, sheet_name="Hallucination_100Q", index=False)
        if ocr_df is not None:
            ocr_df.to_excel(writer, sheet_name="OCR_CER", index=False)

        _style_sheet(writer.sheets["Summary"], summary_df)
        if qa_df is not None:
            _style_sheet(writer.sheets["QA_Test_20Q"], qa_df, color_col="pass", color_true_fill=PASS_FILL, color_false_fill=FAIL_FILL)
        if hallucination_df is not None:
            _style_sheet(writer.sheets["Hallucination_100Q"], hallucination_df, color_col="hallucinated", color_true_fill=FAIL_FILL, color_false_fill=PASS_FILL)
        if ocr_df is not None:
            _style_sheet(writer.sheets["OCR_CER"], ocr_df)

    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
