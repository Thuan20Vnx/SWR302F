// Dựng bộ đề WDU203c từ kết quả OCR ảnh chụp.
// Chạy: node scripts/parse_shots_wdu203c.mjs [--write]
import { readFile, writeFile } from 'node:fs/promises';

const OCR = new URL('../tmp/wdu203c_shots/ocr-all.json', import.meta.url);
const MANUAL = new URL('../scripts/wdu203c-shots-overrides.json', import.meta.url);
const OUTPUT = new URL('../src/data/wdu203c.json', import.meta.url);
const REPORT = new URL('../tmp/wdu203c_shots/parse-report.json', import.meta.url);
const ID_BASE = 3000;
const PER_PAGE = 20;
const OPTION_RE = /^\s*[|}\]]*\s*I?([A-F])(?:\s*[.)_]\s*|\s+)(.*)$/;
const Y_TOLERANCE = 13;

const tidy = (value) =>
  value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:?!])/g, '$1')
    .replace(/([([])\s+/g, '$1')
    .replace(/\s+([)\]])/g, '$1')
    .replace(/^Question\s+\d+\s*/i, '')
    .trim();

const scrub = (value) =>
  tidy(value)
    .replace(/^a (?=[A-Z])/, '')
    .replace(/^(?:ee|rrr,|el|ey|eC|aan\]|cc|eee|TTT)\s+(?=[A-Z])/i, '')
    .replace(/^[—\\\s]+(?=[A-Z])/g, '')
    .replace(
      /\s+(?:OO\b|Re ee\b|eee\b|ggeE|ee reer|ee ee|i e[—-]|DAM AICIAT|5\. Dap an|C\\Diéu)[\s\S]*$/i,
      '',
    )
    .replace(/\s+[—-]+\s*S+\s*$/i, '')
    .replace(/\s*[|€—]+\s*$/g, '')
    .trim();

const isNoise = (text) => /^f?\W*o\W*r\W*u\W*$/i.test(text.trim());
const scoreReading = (text) =>
  (text.match(/ /g) || []).length * 8 + text.length - (text.match(/[^\x20-\x7e]/g) || []).length * 20;

function mergeScales(page) {
  const clusters = [];
  const place = (y) => {
    let cluster = clusters.find((item) => Math.abs(item.y - y) <= Y_TOLERANCE);
    if (!cluster) {
      cluster = { y, readings: [] };
      clusters.push(cluster);
    }
    return cluster;
  };

  for (const [, rawLines] of Object.entries(page).filter(([key]) => key.startsWith('card'))) {
    const lines = rawLines.filter((line) => !isNoise(line.text));
    const rows = [];
    for (const line of lines) {
      let row = rows.find((item) => Math.abs(item.y - line.y) <= 7);
      if (!row) {
        row = { y: line.y, lines: [] };
        rows.push(row);
      }
      row.lines.push(line);
    }
    for (const row of rows) {
      const text = row.lines
        .sort((a, b) => a.x - b.x)
        .map((line) => line.text.trim())
        .join(' ');
      place(row.y).readings.push(text);
    }
  }

  return clusters
    .sort((a, b) => a.y - b.y)
    .map((cluster) => cluster.readings.sort((a, b) => scoreReading(b) - scoreReading(a))[0])
    .map(tidy)
    .filter(Boolean);
}

function splitQuestion(lines) {
  const starts = lines
    .map((line, index) => ({ index, match: line.match(OPTION_RE) }))
    .filter(({ match }) => match?.[1] === 'A')
    .map(({ index }) => {
      const later = new Set(
        lines.slice(index + 1).map((line) => line.match(OPTION_RE)?.[1]).filter(Boolean),
      );
      return { index, score: ['B', 'C', 'D'].filter((letter) => later.has(letter)).length };
    })
    .filter(({ score }) => score >= 1)
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const optionStart = starts[0]?.index ?? lines.length;
  const question = lines.slice(0, optionStart);
  const options = new Map();
  let current = null;
  for (const line of lines.slice(optionStart)) {
    const match = line.match(OPTION_RE);
    if (match && !options.has(match[1])) {
      current = match[1];
      options.set(current, match[2].trim());
    } else if (current) {
      options.set(current, `${options.get(current)} ${line}`.trim());
    }
  }
  return { question: tidy(question.join(' ')), options };
}

function readAnswer(lines) {
  for (const line of lines || []) {
    const answer = line.text.replace(/[^A-F]/gi, '').toUpperCase();
    if (/^[A-F]{1,4}$/.test(answer)) return [...new Set(answer)].sort().join('');
  }
  return '';
}

const readJson = async (url, fallback) => {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return fallback;
  }
};

const ocrPages = JSON.parse(await readFile(OCR, 'utf8'));
const overrides = await readJson(MANUAL, {});
const questions = [];
const skipped = [];
const problems = [];

for (const page of ocrPages) {
  const manual = overrides[page.page];
  if (manual === 'skip') {
    skipped.push({ page: page.page, why: 'bỏ qua theo ghi chú tay' });
    continue;
  }

  const lines = mergeScales(page);
  const parsed = splitQuestion(lines);
  if (parsed.options.size < 2 && !manual?.options) {
    skipped.push({ page: page.page, why: lines.join(' | ').slice(0, 140) });
    continue;
  }

  const question = scrub(manual?.question || parsed.question);
  const options = Object.fromEntries(
    Object.entries({ ...Object.fromEntries(parsed.options), ...manual?.options })
      .filter(([letter]) => !manual?.dropOptions?.includes(letter))
      .map(([letter, text]) => [letter, scrub(text)]),
  );
  const answer = manual?.answer || readAnswer(page.answer);
  const entry = { page: 0, numberOnPage: 0, question, options, answer, id: 0, sourcePage: page.page };

  if (!question || question.length < 10) problems.push({ page: page.page, why: 'câu hỏi thiếu hoặc quá ngắn' });
  if (!answer) problems.push({ page: page.page, why: 'thiếu đáp án' });
  else if ([...answer].some((letter) => !(letter in options))) {
    problems.push({ page: page.page, why: `đáp án ${answer} không có trong lựa chọn` });
  }
  for (const [letter, text] of Object.entries(options)) {
    if (!text) problems.push({ page: page.page, why: `lựa chọn ${letter} rỗng` });
    if (text.length > 24 && !text.includes(' ')) problems.push({ page: page.page, why: `lựa chọn ${letter} có thể mất dấu cách` });
  }
  questions.push(entry);
}

questions.forEach((item, index) => {
  item.id = ID_BASE + index + 1;
  item.page = Math.floor(index / PER_PAGE) + 1;
  item.numberOnPage = (index % PER_PAGE) + 1;
});

await writeFile(REPORT, JSON.stringify({ skipped, problems }, null, 2), 'utf8');
console.log(`${questions.length} câu dựng được`);
console.log(`${skipped.length} trang bỏ qua`);
console.log(`${problems.length} vấn đề cần xem lại`);
problems.slice(0, 40).forEach((item) => console.log(`  trang ${item.page}: ${item.why}`));

if (process.argv.includes('--write')) {
  await writeFile(OUTPUT, `${JSON.stringify(questions, null, 2)}\n`, 'utf8');
  console.log(`Đã ghi ${questions.length} câu vào src/data/wdu203c.json`);
} else {
  console.log('(chạy lại với --write để ghi file)');
}
