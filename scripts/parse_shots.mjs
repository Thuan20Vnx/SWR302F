// Dựng bộ đề SWR302 từ kết quả OCR ảnh chụp (tmp/shots/ocr-all.json).
// Chạy: node scripts/parse_shots.mjs [--write]
//
// Mỗi trang PDF là một câu hỏi. Model OCR bỏ dấu cách khi chữ quá to và bỏ sót
// dòng khi chữ quá nhỏ, nên mỗi thẻ được OCR ở hai tỉ lệ rồi hợp nhất ở đây:
// bản 0.5 cho chữ có dấu cách, bản 1.0 bù những dòng bản kia bỏ sót.
//
// Phần lớn câu đã có sẵn trong bộ SWR302Sample (cùng ngân hàng đề, ảnh chụp nét
// hơn). Câu nào khớp thì lấy nguyên văn bản đã làm sạch của bộ cũ, chỉ giữ đáp
// án của đề chuẩn - nhờ vậy tránh được lỗi OCR trên gần 90% bộ đề.
import { readFile, writeFile } from 'node:fs/promises';

const OCR = new URL('../tmp/shots/ocr-all.json', import.meta.url);
// Vài trang bị bỏ sót dòng ở cả hai tỉ lệ, được OCR lại ở tỉ lệ khác rồi ghép thêm.
const OCR_EXTRA = [
  new URL('../tmp/shots/ocr-extra.json', import.meta.url),
  new URL('../tmp/shots/ocr-extra2.json', import.meta.url),
];
const MANUAL = new URL('../scripts/shots-overrides.json', import.meta.url);
const SAMPLE = new URL('../src/data/swr302sample.json', import.meta.url);
const OUTPUT = new URL('../src/data/swr302.json', import.meta.url);
const REPORT = new URL('../tmp/shots/parse-report.json', import.meta.url);

const ID_BASE = 1000;
const PER_PAGE = 20;

const norm = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const OPTION_RE = /^\s*([A-F])\s*[.)]\s*(.*)$/;
// Watermark "FORU" mờ nằm giữa thẻ, OCR đọc thành nhiều biến thể.
const WATERMARK_RE = /^[fF]\s*[oO0]\s*[rR]\s*[uUvV]$/;
// Tên người chụp và link nguồn nằm đè lên thẻ ở vài trang.
const OVERLAY_RE = /^(hoang\s*hoang|hoanghoang|fuoverflow|fu\s*overflow.*)$/i;

const isNoise = (text) =>
  !text || WATERMARK_RE.test(text) || OVERLAY_RE.test(text.replace(/[|.,]/g, '').trim());

// Mỗi dòng chữ được OCR nhiều lần ở nhiều tỉ lệ. Toạ độ y đã quy về ảnh gốc nên
// các bản đọc của cùng một dòng nằm sát nhau; gom theo y rồi chọn bản đọc tốt
// nhất, tránh vừa mất dấu cách vừa lặp dòng vì hai bản đọc lệch nhau vài ký tự.
const Y_TOLERANCE = 14;

function bestReading(readings) {
  return readings
    .map((text) => ({
      text,
      spaces: (text.match(/ /g) || []).length / Math.max(text.length, 1),
      length: text.length,
    }))
    .sort((a, b) => b.spaces - a.spaces || b.length - a.length)[0].text;
}

function mergeScales(variants) {
  const clusters = [];
  const place = (y) => {
    let cluster = clusters.find((item) => Math.abs(item.y - y) <= Y_TOLERANCE);
    if (!cluster) {
      cluster = { y, readings: [] };
      clusters.push(cluster);
    }
    return cluster;
  };

  for (const variant of variants) {
    // Cùng một tỉ lệ có thể cắt một dòng thành nhiều hộp, ghép lại theo trục x.
    const perCluster = new Map();
    for (const line of variant) {
      const text = line.text.trim();
      if (isNoise(text) || !norm(text)) continue;
      const cluster = place(line.y);
      if (!perCluster.has(cluster)) perCluster.set(cluster, []);
      perCluster.get(cluster).push(line);
    }
    for (const [cluster, lines] of perCluster) {
      cluster.readings.push(
        lines
          .sort((a, b) => a.x - b.x)
          .map((line) => line.text.trim())
          .join(' '),
      );
    }
  }

  return clusters
    .sort((a, b) => a.y - b.y)
    .map((cluster) => ({ y: cluster.y, text: bestReading(cluster.readings) }));
}

function splitQuestion(lines) {
  const question = [];
  const options = new Map();
  let current = null;

  for (const line of lines) {
    const match = line.text.match(OPTION_RE);
    // "A. ..." chỉ mở lựa chọn mới nếu chữ cái đó chưa xuất hiện; câu hỏi có
    // thể chứa "A. B." trong nội dung.
    if (match && !options.has(match[1])) {
      current = match[1];
      options.set(current, match[2].trim());
    } else if (current) {
      options.set(current, `${options.get(current)} ${line.text.trim()}`.trim());
    } else {
      question.push(line.text.trim());
    }
  }

  return { question: question.join(' ').trim(), options };
}

function readAnswer(lines) {
  for (const line of lines) {
    // Chữ cái đáp án đứng một mình nên OCR hay trả về chữ thường.
    const text = line.text.replace(/[\s,.\-]/g, '').toUpperCase();
    if (/^[A-F]{1,4}$/.test(text)) {
      return [...new Set(text.split(''))].sort().join('');
    }
  }
  return '';
}

// Dấu cách thừa/thiếu quanh dấu câu là rác OCR chứ không phải nội dung đề.
function tidy(value) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:?!])/g, '$1')
    .replace(/([([])\s+/g, '$1')
    .replace(/\s+([)\]])/g, '$1')
    .trim();
}

// Dọn ký tự thừa cho mọi nguồn text, kể cả câu lấy từ bộ đề cũ - bộ đó cũng
// được OCR nên còn sót watermark "©", dấu tick "iV)" và nháy cong.
function scrub(value) {
  return tidy(
    value
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      // Watermark dính ở cuối dòng, đôi khi kéo theo một chữ vô nghĩa.
      .replace(/\s*[©®€]\s*(?:[A-Za-z]{1,7})?\s*[_.,]*\s*$/, '')
      // Dấu tick trong đề gốc bị đọc thành "iV)" / "v)".
      .replace(/\s*\b[iIvV]{1,3}\)\s*$/, '')
      .replace(/[^\x20-\x7E]/g, ''),
  );
}

const readJson = async (url, fallback) => {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return fallback;
  }
};

// Dấu vết OCR còn sót: chữ cái lạc lõng đầu/cuối câu, ký tự ngoài bảng chữ cái
// tiếng Anh, dấu cách đôi, dấu chấm lặp.
function suspectArtifact(text) {
  if (/^[a-zA-Z]\s/.test(text) && !/^[AaI]\s/.test(text)) return `mở đầu "${text.slice(0, 2)}"`;
  if (/\s[b-hj-z]$/i.test(text)) return `kết thúc "${text.slice(-2)}"`;
  if (/ {2,}/.test(text)) return 'dấu cách đôi';
  const odd = text.match(/[^\x20-\x7E]/g);
  if (odd) return `ký tự lạ ${[...new Set(odd)].join('')}`;
  if (/\.{2,}(?!\.)/.test(text.replace(/\.\.\./g, ''))) return 'dấu chấm lặp';
  return '';
}

const ocrPages = JSON.parse(await readFile(OCR, 'utf8'));
const sample = JSON.parse(await readFile(SAMPLE, 'utf8'));
const extraPages = (
  await Promise.all(OCR_EXTRA.map((url) => readJson(url, [])))
).flat();
// Trang OCR không đọc nổi thì chép tay theo ảnh, khoá theo số trang PDF.
const overrides = await readJson(MANUAL, {});

const extraByPage = new Map();
for (const entry of extraPages) {
  extraByPage.set(entry.page, [...(extraByPage.get(entry.page) || []), entry]);
}

const variantsOf = (page) =>
  [page, ...(extraByPage.get(page.page) || [])].flatMap((entry) =>
    Object.entries(entry)
      .filter(([key]) => key.startsWith('card'))
      .map(([, lines]) => lines),
  );

// Ngân hàng câu sạch của bộ cũ, tra theo 60 ký tự chữ-số đầu của câu hỏi.
const bank = new Map();
for (const item of sample) bank.set(norm(item.question).slice(0, 60), item);

const questions = [];
const skipped = [];
const problems = [];
const answerConflicts = [];
let fromBank = 0;

for (const page of ocrPages) {
  const manual = overrides[page.page];
  if (manual === 'skip') {
    skipped.push({ page: page.page, text: 'bỏ qua theo ghi chú tay' });
    continue;
  }

  const lines = mergeScales(variantsOf(page));
  const parsed = splitQuestion(lines);
  const answer = readAnswer(page.answer || []);

  if (parsed.options.size < 2 && !manual?.options) {
    skipped.push({ page: page.page, text: lines.map((line) => line.text).join(' | ').slice(0, 80) });
    continue;
  }

  const match = bank.get(norm(parsed.question).slice(0, 60));
  if (match) fromBank += 1;

  // Ghi chú tay là chuẩn cuối cùng, đè lên cả OCR lẫn text của bộ cũ.
  const question = scrub(
    manual?.question || (match ? match.question : parsed.question),
  );
  const options = Object.fromEntries(
    Object.entries({
      ...(match ? match.options : Object.fromEntries(parsed.options)),
      ...manual?.options,
    }).map(([letter, text]) => [letter, scrub(text)]),
  );
  const final = manual?.answer || answer || (match ? match.answer : '');
  if (match && answer && answer !== match.answer) {
    answerConflicts.push({ page: page.page, shot: answer, sample: match.answer, question: question.slice(0, 70) });
  }

  const entry = {
    page: 0,
    numberOnPage: 0,
    question,
    options,
    answer: final,
    id: 0,
    sourcePage: page.page,
    fromBank: Boolean(match),
  };

  for (const [where, text] of [['câu hỏi', question], ...Object.entries(options)]) {
    const artifact = suspectArtifact(text);
    if (artifact) {
      problems.push({ page: page.page, why: `ký tự thừa ở ${where}: ${artifact}`, question: text.slice(0, 70) });
    }
  }

  if (!final) problems.push({ page: page.page, why: 'thiếu đáp án', question: question.slice(0, 70) });
  else if (![...final].every((letter) => letter in options)) {
    problems.push({ page: page.page, why: `đáp án ${final} không có trong lựa chọn`, question: question.slice(0, 70) });
  }
  if (question.length < 12) problems.push({ page: page.page, why: 'câu hỏi quá ngắn', question });

  questions.push(entry);
}

questions.forEach((item, index) => {
  item.id = ID_BASE + index + 1;
  item.page = Math.floor(index / PER_PAGE) + 1;
  item.numberOnPage = (index % PER_PAGE) + 1;
});

console.log(`${questions.length} câu dựng được · ${fromBank} câu lấy text sạch từ bộ cũ`);
console.log(`${skipped.length} trang bỏ qua (trang phân cách / trống)`);
if (answerConflicts.length) {
  console.log(`\n${answerConflicts.length} câu lệch đáp án so với bộ cũ (lấy theo đề chuẩn):`);
  answerConflicts.slice(0, 15).forEach((item) =>
    console.log(`  trang ${item.page}: đề chuẩn ${item.shot} ≠ bộ cũ ${item.sample} · ${item.question}`),
  );
}
if (problems.length) {
  console.log(`\nCẦN XEM LẠI ${problems.length} câu:`);
  problems.slice(0, 25).forEach((item) => console.log(`  trang ${item.page}: ${item.why} · ${item.question}`));
}

await writeFile(
  REPORT,
  JSON.stringify({ skipped, problems, answerConflicts, needsReview: questions.filter((q) => !q.fromBank).map((q) => q.sourcePage) }, null, 2),
  'utf8',
);

if (process.argv.includes('--write')) {
  await writeFile(OUTPUT, `${JSON.stringify(questions, null, 2)}\n`, 'utf8');
  console.log(`\nĐã ghi ${questions.length} câu vào src/data/swr302.json`);
} else {
  console.log('\n(chạy lại với --write để ghi file)');
}
