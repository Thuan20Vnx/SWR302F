"""OCR bộ ảnh chụp đề WDU203c bằng Tesseract.

Chạy: python scripts/ocr_shots_wdu203c.py <pdf> <output.json>
"""

import argparse
import json
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from pypdf import PdfReader


def find_tesseract():
    found = shutil.which("tesseract")
    fallback = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
    if found:
        return found
    if fallback.exists():
        return str(fallback)
    raise RuntimeError("Không tìm thấy Tesseract OCR")


def answer_of(lines):
    for index in range(len(lines) - 1, -1, -1):
        answer = "".join(character for character in lines[index].upper() if character.isalnum())
        if answer and len(answer) <= 6 and all("A" <= character <= "F" for character in answer):
            return index, "".join(sorted(set(answer)))
    return None, ""


def ocr_page(tesseract, page_number, image_path):
    result = subprocess.run(
        [tesseract, str(image_path), "stdout", "-l", "eng", "--psm", "6"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    answer_index, answer = answer_of(lines)
    if answer_index is not None:
        lines.pop(answer_index)
    return {
        "page": page_number,
        "card": [
            {"x": 0, "x2": 0, "y": index * 30, "text": text, "score": 1}
            for index, text in enumerate(lines)
        ],
        "answer": ([{"x": 0, "x2": 0, "y": 0, "text": answer, "score": 1}] if answer else []),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("output")
    parser.add_argument("--first", type=int, default=1)
    parser.add_argument("--last", type=int)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    reader = PdfReader(args.pdf)
    last = min(args.last or len(reader.pages), len(reader.pages))
    numbers = list(range(args.first, last + 1))
    tesseract = find_tesseract()

    with tempfile.TemporaryDirectory(prefix="wdu203c-ocr-") as temp:
        temp_dir = Path(temp)
        images = []
        for number in numbers:
            embedded = list(reader.pages[number - 1].images)
            if len(embedded) != 1:
                raise RuntimeError(f"Trang {number}: cần đúng một ảnh, hiện có {len(embedded)}")
            image_path = temp_dir / f"page-{number:04d}.png"
            embedded[0].image.convert("RGB").save(image_path)
            images.append((number, image_path))

        pages = []
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(ocr_page, tesseract, number, image_path): number
                for number, image_path in images
            }
            for completed, future in enumerate(as_completed(futures), start=1):
                pages.append(future.result())
                if completed % 10 == 0:
                    print(f"done {completed}/{len(numbers)}", flush=True)

    pages.sort(key=lambda page: page["page"])
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(pages, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"done {len(pages)} pages -> {output}", flush=True)


if __name__ == "__main__":
    main()
