"""Character Error Rate (CER) evaluation for the OCR pipeline (src/ocr.py).

Runs eval/ocr_test_images/*.png (rendered from eval/ocr_testset.json's known
ground-truth text — see eval/generate_ocr_images.py) through the real vision
model via transcribe_page(), then scores each page:

    CER = edit_distance(hypothesis, reference) / len(reference)

Lower is better; 0.0 is a perfect transcription. This measures the same
OCR_VISION_MODEL / transcribe_page() path used by the ingestion fallback for
scanned PDFs (src/text_processor.py) and is a good proxy for the structured
extract_ha_document() path used by the 掃描 tab, since both share one model
and prompt style.

Usage:
    python -m eval.ocr_cer
    python -m eval.ocr_cer --testset path.json --output eval/results/run.json
"""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

from src.config import OCR_VISION_MODEL
from src.ocr import transcribe_page

EVAL_DIR = Path(__file__).resolve().parent
DEFAULT_TESTSET = EVAL_DIR / "ocr_testset.json"
DEFAULT_IMAGES_DIR = EVAL_DIR / "ocr_test_images"


def edit_distance(a: str, b: str) -> int:
    """Standard Levenshtein distance (insert/delete/substitute), via DP."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr[j] = min(
                prev[j] + 1,  # deletion
                curr[j - 1] + 1,  # insertion
                prev[j - 1] + cost,  # substitution
            )
        prev = curr
    return prev[-1]


def normalize(text: str) -> str:
    """Strip whitespace/newlines before comparing — layout differences (extra
    blank lines, trailing spaces) aren't OCR *character* errors."""
    return "".join(text.split())


def compute_cer(hypothesis: str, reference: str) -> float:
    ref_norm = normalize(reference)
    hyp_norm = normalize(hypothesis)
    if not ref_norm:
        return 0.0 if not hyp_norm else 1.0
    return edit_distance(hyp_norm, ref_norm) / len(ref_norm)


def load_testset(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def run_case(case: dict, images_dir: Path) -> dict:
    image_path = images_dir / f"{case['id']}.jpg"
    if not image_path.exists():
        raise FileNotFoundError(
            f"{image_path} missing — run `python -m eval.generate_ocr_images` first"
        )
    with open(image_path, "rb") as f:
        image_bytes = f.read()
    hypothesis = transcribe_page(image_bytes)
    cer = compute_cer(hypothesis, case["text"])
    return {
        "id": case["id"],
        "label": case["label"],
        "reference": case["text"],
        "hypothesis": hypothesis,
        "cer": round(cer, 4),
        "accuracy": round(1 - cer, 4),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--testset", type=Path, default=DEFAULT_TESTSET)
    parser.add_argument("--images-dir", type=Path, default=DEFAULT_IMAGES_DIR)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    cases = load_testset(args.testset)
    print(f"Running OCR CER eval on {len(cases)} pages against model {OCR_VISION_MODEL}...\n")

    results = []
    for case in cases:
        print(f"[{case['id']}] {case['label']}...", end=" ", flush=True)
        r = run_case(case, args.images_dir)
        results.append(r)
        print(f"CER={r['cer']:.3f} (accuracy={r['accuracy']:.1%})")

    mean_cer = round(statistics.mean(r["cer"] for r in results), 4) if results else 0.0
    mean_accuracy = round(1 - mean_cer, 4)

    print("\n" + "=" * 60)
    print(f"Mean CER: {mean_cer:.3f}  (mean accuracy: {mean_accuracy:.1%})")

    report = {
        "model": OCR_VISION_MODEL,
        "testset": str(args.testset),
        "summary": {"mean_cer": mean_cer, "mean_accuracy": mean_accuracy, "case_count": len(results)},
        "cases": results,
    }

    output_path = args.output or (EVAL_DIR / "results" / "ocr_latest.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\nFull report written to {output_path}")


if __name__ == "__main__":
    main()
