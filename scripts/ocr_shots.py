"""OCR bộ ảnh chụp đề SWR302 (mỗi trang PDF là một câu hỏi).

Bố cục mỗi trang: thẻ trắng chứa câu hỏi + các lựa chọn A/B/C/D ở nửa trên, ô
xám bên dưới chứa đáp án (và đôi khi phần dịch tiếng Việt). Watermark "FORU" mờ
giữa thẻ và dòng chữ ký bị cắt ở đáy thẻ đều là rác nên chỉ OCR hai vùng cần.

Model nhận dạng nuốt dấu cách khi dòng chữ quá dài ở kích thước gốc, nhưng lại
bỏ sót dòng dài khi thu nhỏ. Vì vậy mỗi thẻ được OCR ở hai tỉ lệ: 1.0 để lấy đủ
dòng, 0.5 để lấy bản có dấu cách; bước ghép nằm ở scripts/parse_shots.mjs.

Chạy: python scripts/ocr_shots.py <pdf> <output.json> [--first N] [--last N]
"""

import argparse
import gc
import json
from pathlib import Path

import numpy as np
from pypdf import PdfReader
from rapidocr_onnxruntime import RapidOCR

# Toạ độ theo ảnh gốc 2290x1296.
CARD_BOX = (300, 60, 2020, 870)
ANSWER_BOX = (20, 945, 1600, 1290)
CARD_SCALES = (1.0, 0.5)


def page_image(page):
    images = list(page.images)
    if len(images) != 1:
        raise RuntimeError(f"Expected one image, found {len(images)}")
    return images[0].image.convert("RGB")


def ocr(engine, image, scale=1.0):
    if scale != 1.0:
        image = image.resize((int(image.width * scale), int(image.height * scale)))
    result, _ = engine(np.array(image))
    lines = []
    for points, text, score in result or []:
        text = text.strip()
        if not text:
            continue
        lines.append(
            {
                "x": round(min(p[0] for p in points) / scale, 1),
                "y": round(sum(p[1] for p in points) / 4 / scale, 1),
                "text": text,
                "score": round(float(score), 3),
            }
        )
    del result
    return sorted(lines, key=lambda item: (item["y"], item["x"]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("output")
    parser.add_argument("--first", type=int, default=1)
    parser.add_argument("--last", type=int)
    # Trang khó đọc thì chạy lại riêng ở tỉ lệ khác rồi ghép thêm vào.
    parser.add_argument("--pages", help="danh sách trang, ví dụ 12,51,89")
    parser.add_argument("--scales", help="ví dụ 0.7,0.35")
    args = parser.parse_args()

    reader = PdfReader(args.pdf)
    last = min(args.last or len(reader.pages), len(reader.pages))
    numbers = (
        [int(value) for value in args.pages.split(",")]
        if args.pages
        else list(range(args.first, last + 1))
    )
    scales = (
        tuple(float(value) for value in args.scales.split(","))
        if args.scales
        else CARD_SCALES
    )
    card_engine = RapidOCR()
    # Đáp án nhiều khi chỉ là một chữ cái giữa ô trống nên ngưỡng mặc định loại mất.
    answer_engine = RapidOCR(text_score=0.1, box_thresh=0.3)

    pages = []
    for number in numbers:
        image = page_image(reader.pages[number - 1])
        card = image.crop(CARD_BOX)
        entry = {"page": number, "size": [image.width, image.height]}
        for scale in scales:
            entry[f"card{scale}"] = ocr(card_engine, card, scale)
        entry["answer"] = ocr(answer_engine, image.crop(ANSWER_BOX))
        pages.append(entry)
        del image, card
        if number % 10 == 0:
            gc.collect()
            print(f"page {number}/{last}", flush=True)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(pages, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"done {len(pages)} pages -> {output}", flush=True)


if __name__ == "__main__":
    main()
