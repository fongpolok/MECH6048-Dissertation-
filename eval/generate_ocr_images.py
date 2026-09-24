"""Renders eval/ocr_testset.json's ground-truth text into page images that look
like photographed HA documents, so eval/ocr_cer.py has something to OCR against
a known-correct reference. Run once (or whenever ocr_testset.json changes):

    python -m eval.generate_ocr_images

Images are checked into eval/ocr_test_images/ so the CER eval is reproducible
without needing to regenerate them on every run.

A page rendered flat with perfect anti-aliased text and no noise is not
representative of what the 掃描 tab actually receives (a phone photo of a
printed page) — OCR against that would score ~100% and tell us nothing. So
each page also gets a "photographed" pass: slight rotation, blur, luminance
noise and JPEG re-compression, to produce a realistic, non-trivial CER.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

EVAL_DIR = Path(__file__).resolve().parent
TESTSET_PATH = EVAL_DIR / "ocr_testset.json"
IMAGES_DIR = EVAL_DIR / "ocr_test_images"

# macOS system CJK font — renders Traditional Chinese correctly, which is what
# actually exercises the OCR model (a Latin-only fallback font would make this
# test meaningless for a Cantonese-language app).
FONT_PATH = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_SIZE = 30
LINE_SPACING = 16
PAGE_WIDTH = 900
MARGIN = 50

RNG_SEED = 42  # fixed, so the "photographed" degradation is reproducible across runs


def render_page(text: str) -> Image.Image:
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    lines = text.split("\n")
    line_height = FONT_SIZE + LINE_SPACING
    height = MARGIN * 2 + line_height * len(lines)
    img = Image.new("RGB", (PAGE_WIDTH, height), "white")
    draw = ImageDraw.Draw(img)
    y = MARGIN
    for line in lines:
        draw.text((MARGIN, y), line, font=font, fill="black")
        y += line_height
    return img


def _perspective_coeffs(width: int, height: int, jitter: float, rng: np.random.Generator) -> tuple:
    """Random small perspective warp (a hand holding a phone is never
    perfectly parallel to the page) — PIL's QUAD->coeffs solve."""
    src = [(0, 0), (width, 0), (width, height), (0, height)]
    dst = [
        (rng.uniform(0, jitter * width), rng.uniform(0, jitter * height)),
        (width - rng.uniform(0, jitter * width), rng.uniform(0, jitter * height)),
        (width - rng.uniform(0, jitter * width), height - rng.uniform(0, jitter * height)),
        (rng.uniform(0, jitter * width), height - rng.uniform(0, jitter * height)),
    ]
    matrix = []
    for (x, y), (X, Y) in zip(dst, src):
        matrix.append([x, y, 1, 0, 0, 0, -X * x, -X * y])
        matrix.append([0, 0, 0, x, y, 1, -Y * x, -Y * y])
    A = np.array(matrix, dtype=np.float64)
    B = np.array(src, dtype=np.float64).reshape(8)
    res = np.linalg.solve(A, B)
    return tuple(res)


def _lighting_gradient(size: tuple, rng: np.random.Generator) -> Image.Image:
    """Uneven brightness across the page (desk lamp / window light from one
    side) as a multiplicative mask — real photos are rarely lit perfectly
    evenly, and uneven contrast is a genuine OCR difficulty a flat render
    can't reproduce."""
    width, height = size
    angle = rng.uniform(0, 2 * np.pi)
    dx, dy = np.cos(angle), np.sin(angle)
    xs, ys = np.meshgrid(np.linspace(-1, 1, width), np.linspace(-1, 1, height))
    gradient = xs * dx + ys * dy
    gradient = (gradient - gradient.min()) / (gradient.max() - gradient.min())
    strength = rng.uniform(0.25, 0.45)
    brightness = 1 - strength + strength * gradient
    return brightness.astype(np.float64)


def photograph(img: Image.Image, rng: np.random.Generator) -> Image.Image:
    """Simulates a hand-held phone photo of a printed page under imperfect
    lighting: rotation, perspective skew, an uneven lighting gradient,
    defocus blur, sensor noise, then JPEG re-encoding at a phone-camera-ish
    quality — each of which a real scan has and a flat render doesn't."""
    angle = rng.uniform(-3.5, 3.5)
    rotated = img.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor="white")

    coeffs = _perspective_coeffs(rotated.width, rotated.height, jitter=0.03, rng=rng)
    warped = rotated.transform(rotated.size, Image.PERSPECTIVE, coeffs, resample=Image.BICUBIC, fillcolor="white")

    blurred = warped.filter(ImageFilter.GaussianBlur(radius=rng.uniform(1.2, 1.9)))

    arr = np.asarray(blurred).astype(np.float64)
    brightness = _lighting_gradient(blurred.size, rng)[..., None]
    lit = arr * brightness
    noise = rng.normal(0, 16, arr.shape)
    noisy = np.clip(lit + noise, 0, 255).astype(np.uint8)
    noisy_img = Image.fromarray(noisy)

    buf = io.BytesIO()
    noisy_img.save(buf, format="JPEG", quality=int(rng.integers(30, 45)))
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def main():
    IMAGES_DIR.mkdir(exist_ok=True)
    rng = np.random.default_rng(RNG_SEED)
    with open(TESTSET_PATH, encoding="utf-8") as f:
        cases = json.load(f)
    for case in cases:
        clean = render_page(case["text"])
        photo = photograph(clean, rng)
        out_path = IMAGES_DIR / f"{case['id']}.jpg"
        photo.save(out_path, format="JPEG", quality=90)
        print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
