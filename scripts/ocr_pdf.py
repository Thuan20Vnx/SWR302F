import argparse
import json
from pathlib import Path

import gc
import numpy as np
from PIL import Image
from pypdf import PdfReader
from rapidocr_onnxruntime import RapidOCR


def extract_page_image(page):
    images = list(page.images)
    if len(images) != 1:
        raise RuntimeError(f"Expected one image on page, found {len(images)}")
    return Image.open(__import__("io").BytesIO(images[0].data)).convert("RGB")


def ocr_image(engine, image, chunk_height=1800, overlap=120):
    width, height = image.size
    lines = []
    start = 0
    chunk_index = 0

    while start < height:
        end = min(height, start + chunk_height)
        crop = np.array(image.crop((0, start, width, end)))
        result, _ = engine(crop)
        for box, text, score in result or []:
            center_y = sum(point[1] for point in box) / 4 + start
            # Keep each overlap line only in the chunk whose non-overlap region owns it.
            if chunk_index and center_y < start + overlap / 2:
                continue
            if end < height and center_y >= end - overlap / 2:
                continue
            lines.append(
                {
                    "x": round(min(point[0] for point in box), 1),
                    "y": round(center_y, 1),
                    "text": text.strip(),
                    "score": round(float(score), 4),
                }
            )
        if end == height:
            break
        del crop, result
        gc.collect()
        start = end - overlap
        chunk_index += 1
        print(f"  chunk {chunk_index}: y={start}", flush=True)

    return sorted(lines, key=lambda item: (item["y"], item["x"]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("output")
    parser.add_argument("--first", type=int, default=1)
    parser.add_argument("--last", type=int)
    args = parser.parse_args()

    reader = PdfReader(args.pdf)
    last = min(args.last or len(reader.pages), len(reader.pages))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    engine = RapidOCR()

    pages = []
    for page_number in range(args.first, last + 1):
        image = extract_page_image(reader.pages[page_number - 1])
        lines = ocr_image(engine, image)
        pages.append(
            {
                "page": page_number,
                "width": image.width,
                "height": image.height,
                "lines": lines,
            }
        )
        print(f"page {page_number}: {len(lines)} lines", flush=True)

    output.write_text(json.dumps(pages, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
