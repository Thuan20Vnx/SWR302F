import json
import re
from pathlib import Path


OCR_DIR = Path("tmp/pdfs/ocr")
OUTPUT = Path("src/questions.json")
REPORT = Path("tmp/pdfs/parse-report.json")

OPTION_RE = re.compile(r"^\s*([A-F])[\.\),:]\s*(.+)", re.I)
SOURCE_RE = re.compile(r"\bSource\b", re.I)
ANSWER_RE = re.compile(r"^\s*([A-F]{1,6})\s*[.\-]?\s*$", re.I)
QUESTION_START_RE = re.compile(
    r"^[\"'“”‘’]?(Which|What|When|Where|Who|Whom|Whose|Why|How|In\b|During\b|"
    r"According\b|Consider\b|If\b|For\b|The\b|A\b|An\b|Some\b|"
    r"Stakeholders\b|Requirements\b|Acceptance\b|Use cases?\b|"
    r"Business\b|Software\b|Agile\b|Project\b|Product\b|System\b|"
    r"Two\b|We\b|Customers\b|Entries\b|Requirement\b|Develop\b|"
    r"Evaluate\b|While\b|Define\b|Fill\b|Organize\b|Story\b|"
    r"Outsourced\b|Prioritization\b|Every\b|Elicitation\b)",
    re.I,
)
NOISE_RE = re.compile(
    r"^(Dich|Dap an|Giai thich|Giải thích|Hoang|Hodng|FPT UNIVERSITY|Source)\b",
    re.I,
)

ANSWER_OVERRIDES = {
    112: "A",
    140: "C",
    176: "B",
    241: "F",
    247: "C",
    266: "C",
    290: "C",
    329: "C",
    342: "C",
    349: "C",
    350: "C",
    351: "C",
    356: "C",
    362: "C",
    383: "C",
}


def clean(line):
    value = re.sub(r"\s+", " ", line).strip(" |")
    value = re.sub(r"\s*[©®@]?\s*(?:Hodng|Hoang).*$", "", value, flags=re.I)
    return value.strip()


def choice_sequences(lines):
    a_indexes = [
        idx
        for idx, line in enumerate(lines)
        if (match := OPTION_RE.match(line)) and match.group(1).upper() == "A"
    ]
    sequences = []
    for number, a_index in enumerate(a_indexes):
        next_a = a_indexes[number + 1] if number + 1 < len(a_indexes) else len(lines)
        source_index = next(
            (
                idx
                for idx in range(a_index + 1, next_a)
                if SOURCE_RE.search(lines[idx])
            ),
            next_a,
        )
        starts = {"A": a_index}
        expected_ord = ord("B")
        for idx in range(a_index + 1, source_index):
            match = OPTION_RE.match(lines[idx])
            if not match:
                continue
            letter = match.group(1).upper()
            if ord(letter) == expected_ord:
                starts[letter] = idx
                expected_ord += 1
        if "B" in starts:
            sequences.append(starts)
    return sequences


def extract_choice(lines, start, end):
    match = OPTION_RE.match(lines[start])
    parts = [match.group(2)] if match else [lines[start]]
    for line in lines[start + 1 : end]:
        if SOURCE_RE.search(line) or ANSWER_RE.fullmatch(line):
            break
        parts.append(line)
    value = clean(" ".join(parts))
    value = re.split(
        r"\s+[¢©]?\s*(?=(?:Which|What|When|Where|Why|How)\b)", value, maxsplit=1
    )[0]
    return value


def extract_question(lines, a_index, previous_end):
    candidates = [clean(x) for x in lines[max(previous_end, a_index - 14) : a_index]]
    candidates = [x for x in candidates if x and not SOURCE_RE.search(x)]
    start = None
    for idx, line in enumerate(candidates):
        if QUESTION_START_RE.match(line) and not NOISE_RE.match(line):
            start = idx
        elif (
            not NOISE_RE.match(line)
            and re.match(r"^[\"'“”‘’]?[A-Z][A-Za-z]+", line)
            and ("?" in line or "Choose" in line or "Select" in line or "Fill in" in line)
        ):
            start = idx
    if start is None:
        usable = [x for x in candidates if not NOISE_RE.match(x)]
        return clean(" ".join(usable[-3:]))
    # Prefer the earliest plausible question in the final English run.
    while start > 0 and QUESTION_START_RE.match(candidates[start - 1]):
        start -= 1
    question = clean(" ".join(candidates[start:]))
    question = re.sub(r"^[B-F]\s+", "", question)
    return re.sub(r"^A\s+(?=[A-Z\"'“”‘’])", "", question)


def extract_answer(lines, last_option_index, next_a):
    window = lines[last_option_index + 1 : next_a]
    for line in window:
        stripped = re.sub(r"[\s,]", "", clean(line).upper())
        match = ANSWER_RE.fullmatch(stripped)
        if match:
            letters = re.findall(r"[A-F]", match.group(1).upper())
            return "".join(dict.fromkeys(letters))
        prefix = re.match(r"^([A-F]{1,6})(?:@|\s)", stripped)
        if prefix:
            return "".join(dict.fromkeys(prefix.group(1)))
    for line in window:
        if re.search(r"Dap an (?:dung|đúng)", line, re.I):
            letters = re.findall(r"\b[A-F]\b", line.upper())
            if letters:
                return "".join(dict.fromkeys(letters))
    return ""


def parse_page(path, page_number):
    lines = [clean(x) for x in path.read_text(encoding="utf-8", errors="replace").splitlines()]
    sequences = choice_sequences(lines)
    questions = []
    previous_end = 0
    for number, starts in enumerate(sequences):
        next_a = sequences[number + 1]["A"] if number + 1 < len(sequences) else len(lines)
        letters = sorted(starts, key=lambda letter: starts[letter])
        boundaries = [starts[letter] for letter in letters] + [next_a]
        options = {
            letter: extract_choice(lines, boundaries[idx], boundaries[idx + 1])
            for idx, letter in enumerate(letters)
        }
        last_option = starts[letters[-1]]
        answer = extract_answer(lines, last_option, next_a)
        question = extract_question(lines, starts["A"], previous_end)
        previous_end = last_option + 1
        if question and len(options) >= 2 and all(options.values()):
            questions.append(
                {
                    "page": page_number,
                    "numberOnPage": len(questions) + 1,
                    "question": question,
                    "options": options,
                    "answer": answer,
                }
            )
    return questions


def main():
    lines = []
    line_pages = []
    for page_number, path in enumerate(sorted(OCR_DIR.glob("page-*.txt")), 1):
        page_lines = [
            clean(x)
            for x in path.read_text(encoding="utf-8", errors="replace").splitlines()
        ]
        lines.extend(page_lines)
        line_pages.extend([page_number] * len(page_lines))

    sequences = choice_sequences(lines)
    all_questions = []
    previous_end = 0
    page_counters = {}
    for number, starts in enumerate(sequences):
        next_a = sequences[number + 1]["A"] if number + 1 < len(sequences) else len(lines)
        letters = sorted(starts, key=lambda letter: starts[letter])
        boundaries = [starts[letter] for letter in letters] + [next_a]
        options = {
            letter: extract_choice(lines, boundaries[idx], boundaries[idx + 1])
            for idx, letter in enumerate(letters)
        }
        last_option = starts[letters[-1]]
        answer = extract_answer(lines, last_option, next_a)
        question = extract_question(lines, starts["A"], previous_end)
        previous_end = last_option + 1
        page_number = line_pages[starts["A"]]
        page_counters[page_number] = page_counters.get(page_number, 0) + 1
        if question and len(options) >= 2 and all(options.values()):
            all_questions.append(
                {
                    "page": page_number,
                    "numberOnPage": page_counters[page_number],
                    "question": question,
                    "options": options,
                    "answer": answer,
                }
            )

    for index, question in enumerate(all_questions, 1):
        question["id"] = index
        question["question"] = re.sub(r"^[B-F]\s+", "", question["question"])
        if not question["answer"] and index in ANSWER_OVERRIDES:
            question["answer"] = ANSWER_OVERRIDES[index]
        if index == 279:
            question["question"] = (
                "Which arrangement describes the increasing amount of requirements "
                "and development work when implementing packaged solutions? "
                "Order: 1 configured, 2 integrated, 3 extended, 4 out of the box."
            )
        if index == 334:
            question["options"]["D"] = (
                "To propose strategies for mitigating project risks"
            )

    per_page = {}
    for page_number in range(1, 21):
        page_questions = [q for q in all_questions if q["page"] == page_number]
        per_page[str(page_number)] = {
            "count": len(page_questions),
            "missingAnswers": sum(not q["answer"] for q in page_questions),
        }

    OUTPUT.write_text(
        json.dumps(all_questions, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    REPORT.write_text(
        json.dumps(
            {
                "total": len(all_questions),
                "missingAnswers": sum(not q["answer"] for q in all_questions),
                "perPage": per_page,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(REPORT.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
