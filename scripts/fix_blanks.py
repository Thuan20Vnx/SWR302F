"""Chạy lại bước dò chỗ trống "______" và vá vào file OCR có sẵn.

Dò chỗ trống chỉ đọc điểm ảnh nên nhanh hơn OCR rất nhiều; khi chỉnh luật dò thì
dùng script này thay vì OCR lại cả bộ.

Chạy: python scripts/fix_blanks.py <pdf> <ocr.json>
"""

import json
import sys
from pathlib import Path

from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).parent))
from ocr_shots import CARD_BOX, find_blanks, page_image  # noqa: E402


def main():
    pdf, ocr_path = sys.argv[1], Path(sys.argv[2])
    reader = PdfReader(pdf)
    pages = json.loads(ocr_path.read_text(encoding="utf-8"))

    total = 0
    for entry in pages:
        card = page_image(reader.pages[entry["page"] - 1]).crop(CARD_BOX)
        entry["blanks"] = find_blanks(card)
        total += len(entry["blanks"])
        if entry["page"] % 50 == 0:
            print(f"page {entry['page']}", flush=True)

    ocr_path.write_text(json.dumps(pages, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{total} chỗ trống trên {sum(1 for e in pages if e['blanks'])} trang")


if __name__ == "__main__":
    main()
