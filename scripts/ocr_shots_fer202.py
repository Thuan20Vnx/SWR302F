"""OCR bộ ảnh chụp đề FER202 (mỗi trang PDF là một câu hỏi).

Bản sao của ocr_shots.py với toạ độ vùng cắt đo lại cho ảnh chụp FER202
(2316x1264, viền thẻ và khung đáp án lệch một chút so với bộ SWR302). Đề
FER202 là chữ render sẵn (không phải ảnh chụp mờ) nên vẫn OCR ở hai tỉ lệ để
tránh lỗi nuốt dấu cách / bỏ dòng dài như mô tả trong ocr_shots.py, nhưng
khung đáp án phải hẹp hơn nhiều (rộng 800px thay vì gần hết bề ngang) vì
model bỏ sót một chữ cái đơn độc nếu vùng cắt quá dẹt ngang.

Chạy: python scripts/ocr_shots_fer202.py <pdf> <output.json> [--first N] [--last N]
"""

import argparse
import gc
import json
from pathlib import Path

import numpy as np
from pypdf import PdfReader
from rapidocr_onnxruntime import RapidOCR

# Toạ độ theo ảnh gốc 2316x1264.
CARD_BOX = (270, 55, 2040, 1010)
ANSWER_BOX = (0, 1050, 800, 1264)
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
                "x2": round(max(p[0] for p in points) / scale, 1),
                "y": round(sum(p[1] for p in points) / 4 / scale, 1),
                "text": text,
                "score": round(float(score), 3),
            }
        )
    del result
    return sorted(lines, key=lambda item: (item["y"], item["x"]))


# Chỗ trống "______" của câu điền khuyết là một vệt đen nằm ngang, mảnh và dài;
# model nhận dạng bỏ qua hoàn toàn nên phải dò bằng điểm ảnh.
BLANK_MIN_WIDTH = 34
# Vệt dài hơn thế này là viền thẻ hoặc thanh đen ở đầu ảnh, không phải chỗ trống.
BLANK_MAX_WIDTH = 430
BLANK_MAX_HEIGHT = 7


def find_blanks(card):
    dark = np.array(card.convert("L")) < 150
    blanks = []

    for row in range(dark.shape[0]):
        line = dark[row]
        if not line.any():
            continue
        edges = np.diff(np.concatenate(([0], line.view(np.int8), [0])))
        starts = np.flatnonzero(edges == 1)
        ends = np.flatnonzero(edges == -1)
        for start, end in zip(starts, ends):
            if not BLANK_MIN_WIDTH <= end - start <= BLANK_MAX_WIDTH:
                continue
            # Gộp với vệt của dòng ngay trên nếu cùng vị trí: gạch dưới dày 2-4px.
            previous = next(
                (
                    item
                    for item in blanks
                    if item["y2"] >= row - 2
                    and abs(item["x"] - start) < 6
                    and abs(item["x2"] - end) < 6
                ),
                None,
            )
            if previous:
                previous["y2"] = row
            else:
                blanks.append({"x": int(start), "x2": int(end), "y": row, "y2": row})

    result = []
    for item in blanks:
        if item["y2"] - item["y"] > BLANK_MAX_HEIGHT:
            continue
        # Thanh đen viền trên của ảnh chụp cũng là một vệt ngang mảnh.
        if item["y"] < 30:
            continue
        # Gạch dưới của chỗ trống có khoảng trắng ngay bên trên; nét ngang của
        # chữ cái to (trang phân cách) thì không.
        top = max(0, item["y"] - 10)
        above = dark[top : max(top, item["y"] - 2), item["x"] : item["x2"]]
        if above.size and above.mean() > 0.02:
            continue
        result.append(
            {
                "x": item["x"],
                "x2": item["x2"],
                # Quy về giữa dòng chữ cho khớp với toạ độ y của hộp chữ.
                "y": round((item["y"] + item["y2"]) / 2 - 12, 1),
            }
        )
    return result


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
        entry["blanks"] = find_blanks(card)
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
