"""Ghép ảnh các trang cần soát tay thành vài tấm để xem nhanh.

Chạy: python scripts/shots_review.py <pdf> <trang,trang,...> [--out tmp/shots/review] [--per 2]
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw
from pypdf import PdfReader

CARD_BOX = (300, 40, 2020, 880)
ANSWER_BOX = (20, 935, 1900, 1140)
WIDTH = 1000


def strip(image, box, width=WIDTH):
    crop = image.crop(box)
    height = round(crop.height * width / crop.width)
    return crop.resize((width, height))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("pages")
    parser.add_argument("--out", default="tmp/shots/review")
    parser.add_argument("--per", type=int, default=2)
    # Soát chỗ trống thì chỉ cần dải câu hỏi, xếp được nhiều trang trên một tấm.
    parser.add_argument("--question-only", action="store_true")
    args = parser.parse_args()

    reader = PdfReader(args.pdf)
    numbers = [int(value) for value in args.pages.split(",")]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    for start in range(0, len(numbers), args.per):
        chunk = numbers[start : start + args.per]
        blocks = []
        for number in chunk:
            image = list(reader.pages[number - 1].images)[0].image.convert("RGB")
            if args.question_only:
                blocks.append((number, strip(image, (300, 90, 2020, 330)), None))
            else:
                blocks.append((number, strip(image, CARD_BOX), strip(image, ANSWER_BOX)))

        height = sum(card.height + (answer.height if answer else 0) + 34 for _, card, answer in blocks)
        sheet = Image.new("RGB", (WIDTH, height), "white")
        draw = ImageDraw.Draw(sheet)
        y = 0
        for number, card, answer in blocks:
            draw.text((6, y + 6), f"PAGE {number}", fill="red")
            y += 24
            sheet.paste(card, (0, y))
            y += card.height + 4
            if answer:
                sheet.paste(answer, (0, y))
                y += answer.height + 6
            draw.line((0, y, WIDTH, y), fill="red", width=2)

        name = out / f"rev-{'-'.join(str(n) for n in chunk)}.png"
        sheet.save(name)
        print(name)


if __name__ == "__main__":
    main()
