// Dựng bộ đề FER202 từ kết quả OCR ảnh chụp (tmp/fer202_shots/ocr-all.json).
// Chạy: node scripts/parse_shots_fer202.mjs [--write]
//
// Bản rút gọn của parse_shots.mjs: đề FER202 không có bộ đề "sạch" nào khác để
// đối chiếu (SWR302 có SWR302Sample), nên toàn bộ câu hỏi/lựa chọn lấy thẳng
// từ OCR, chỉ hợp nhất hai tỉ lệ quét (1.0 và 0.5) để bù lỗi nuốt dấu cách /
// bỏ dòng dài của model, giống hệt cơ chế trong parse_shots.mjs.
import { readFile, writeFile } from 'node:fs/promises';

const OCR = new URL('../tmp/fer202_shots/ocr-all.json', import.meta.url);
const MANUAL = new URL('../scripts/fer202-shots-overrides.json', import.meta.url);
const OUTPUT = new URL('../src/data/fer202.json', import.meta.url);
const REPORT = new URL('../tmp/fer202_shots/parse-report.json', import.meta.url);

const ID_BASE = 2000;
const PER_PAGE = 20;

const norm = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const OPTION_RE = /^\s*([A-F])\s*[.)]\s*(.*)$/;
// Watermark "FORU" mờ nằm giữa thẻ, OCR đọc thành nhiều biến thể.
const WATERMARK_RE = /^[fF]\s*[oO0]\s*[rR]\s*[uUvV]$/;
// Tên người chụp và link nguồn nằm đè lên thẻ ở vài trang.
const OVERLAY_RE = /^(hoang\s*hoang|hoanghoang|fuoverflow|fu\s*overflow.*)$/i;

// "Hoàng Hoàng Buôn Source" (chữ ký) và "FORU / LEARN TO KNOW" (watermark) OCR
// ra rất nhiều biến thể chữ (dấu bị nuốt/đọc sai) nên regex theo chữ bỏ sót
// phần lớn. Watermark là ảnh tĩnh đè cố định một vị trí trên mọi thẻ (khung
// OCR luôn cùng toạ độ), nên lọc theo hộp toạ độ đáng tin cậy hơn nhiều: chữ
// ký luôn nằm trong x∈[1200,1750] y∈[830,900], watermark FORU/tagline luôn
// nằm trong x∈[790,1000] y∈[350,450] (đo trên toàn bộ 317 trang).
const inBox = (line, [x1, x2, y1, y2]) =>
  line.x >= x1 && line.x <= x2 && line.y >= y1 && line.y <= y2;
const SIGNATURE_BOX = [1200, 1750, 830, 900];
const WATERMARK_BOX = [790, 1000, 350, 450];
const isWatermarkPosition = (line) =>
  inBox(line, SIGNATURE_BOX) || inBox(line, WATERMARK_BOX);

const isNoise = (text) =>
  !text || WATERMARK_RE.test(text) || OVERLAY_RE.test(text.replace(/[|.,]/g, '').trim());

// Mỗi dòng chữ được OCR nhiều lần ở nhiều tỉ lệ. Toạ độ y đã quy về ảnh gốc nên
// các bản đọc của cùng một dòng nằm sát nhau; gom theo y rồi chọn bản đọc tốt
// nhất, tránh vừa mất dấu cách vừa lặp dòng vì hai bản đọc lệch nhau vài ký tự.
const Y_TOLERANCE = 14;

const BLANK = '______';

function bestReading(readings) {
  return readings
    .map((reading) => ({
      reading,
      spaces:
        (reading.text.match(/ /g) || []).length / Math.max(reading.text.length, 1),
    }))
    .sort(
      (a, b) => b.spaces - a.spaces || b.reading.text.length - a.reading.text.length,
    )[0].reading;
}

// Chỗ trống là một vệt gạch dưới, không có chữ nên OCR bỏ qua hoàn toàn. Biết
// vị trí x của vệt và của từng hộp chữ thì chèn được "______" vào đúng chỗ.
function insertBlank(boxes, blank) {
  const inside = boxes.find(
    (box) => blank.x > box.x + 4 && blank.x2 < box.x2 - 4,
  );
  if (inside) {
    const blankWidth = blank.x2 - blank.x;
    const textWidth = Math.max(inside.x2 - inside.x - blankWidth, 1);
    const ratio = (blank.x - inside.x) / textWidth;
    const cut = Math.round(ratio * inside.text.length);
    const space = inside.text.lastIndexOf(' ', cut);
    const at = space > 0 ? space : cut;
    return boxes.flatMap((box) =>
      box === inside
        ? [
            { x: box.x, x2: blank.x, text: box.text.slice(0, at).trim() },
            { x: blank.x, x2: blank.x2, text: BLANK },
            { x: blank.x2, x2: box.x2, text: box.text.slice(at).trim() },
          ].filter((part) => part.text)
        : [box],
    );
  }

  const before = boxes.filter((box) => box.x2 <= blank.x + 8).length;
  return [...boxes.slice(0, before), { text: BLANK }, ...boxes.slice(before)];
}

// Một chỗ trống dài đôi khi bị dò thành vài vệt sát nhau, gộp lại trước.
function mergeBlanks(blanks) {
  return [...blanks]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .reduce((merged, blank) => {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last.y - blank.y) <= 16 && blank.x - last.x2 <= 26) {
        last.x2 = Math.max(last.x2, blank.x2);
        return merged;
      }
      return [...merged, { ...blank }];
    }, []);
}

function mergeScales(variants, rawBlanks = []) {
  const blanks = mergeBlanks(rawBlanks);
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
    const perCluster = new Map();
    for (const line of variant) {
      const text = line.text.trim();
      if (isNoise(text) || !norm(text) || isWatermarkPosition(line)) continue;
      const cluster = place(line.y);
      if (!perCluster.has(cluster)) perCluster.set(cluster, []);
      perCluster.get(cluster).push(line);
    }
    for (const [cluster, lines] of perCluster) {
      const boxes = lines
        .sort((a, b) => a.x - b.x)
        .map((line) => ({ x: line.x, x2: line.x2 ?? line.x, text: line.text.trim() }));
      cluster.readings.push({
        boxes,
        text: boxes.map((box) => box.text).join(' '),
        hasWidth: lines.every((line) => line.x2 !== undefined),
      });
    }
  }

  for (const blank of blanks) {
    if (!clusters.some((cluster) => Math.abs(blank.y - cluster.y) <= 16)) {
      clusters.push({ y: blank.y, readings: [{ boxes: [], text: '', hasWidth: true }] });
    }
  }

  return clusters
    .sort((a, b) => a.y - b.y)
    .map((cluster) => {
      const own = blanks
        .filter((blank) => Math.abs(blank.y - cluster.y) <= 16)
        .sort((a, b) => b.x - a.x);
      const usable = own.length
        ? cluster.readings.filter((reading) => reading.hasWidth)
        : [];
      const reading = bestReading(usable.length ? usable : cluster.readings);
      let boxes = reading.boxes;
      for (const blank of own) boxes = insertBlank(boxes, blank);
      return { y: cluster.y, text: boxes.map((box) => box.text).join(' ').trim() };
    });
}

function splitQuestion(lines) {
  const question = [];
  const options = new Map();
  let current = null;

  for (const line of lines) {
    const match = line.text.match(OPTION_RE);
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
    const text = line.text.replace(/[\s,.\-]/g, '').toUpperCase();
    if (/^[A-F]{1,4}$/.test(text)) {
      return [...new Set(text.split(''))].sort().join('');
    }
  }
  return '';
}

function tidy(value) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:?!])/g, '$1')
    .replace(/([([])\s+/g, '$1')
    .replace(/\s+([)\]])/g, '$1')
    .trim();
}

function scrub(value) {
  return tidy(
    value
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s*[©®€]\s*(?:[A-Za-z]{1,7})?\s*[_.,]*\s*$/, '')
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
// Trang OCR không đọc nổi thì chép tay theo ảnh, khoá theo số trang PDF.
const overrides = await readJson(MANUAL, {});

const variantsOf = (page) =>
  Object.entries(page)
    .filter(([key]) => key.startsWith('card'))
    .map(([, lines]) => lines);

const questions = [];
const skipped = [];
const problems = [];

for (const page of ocrPages) {
  const manual = overrides[page.page];
  if (manual === 'skip') {
    skipped.push({ page: page.page, text: 'bỏ qua theo ghi chú tay' });
    continue;
  }

  const lines = mergeScales(variantsOf(page), page.blanks || []);
  const parsed = splitQuestion(lines);
  const answer = readAnswer(page.answer || []);

  if (parsed.options.size < 2 && !manual?.options) {
    skipped.push({ page: page.page, text: lines.map((line) => line.text).join(' | ').slice(0, 80) });
    continue;
  }

  const question = scrub(manual?.question || parsed.question);
  const options = Object.fromEntries(
    Object.entries({ ...Object.fromEntries(parsed.options), ...manual?.options })
      .filter(([letter]) => !manual?.dropOptions?.includes(letter))
      .map(([letter, text]) => [letter, scrub(text)]),
  );
  const final = manual?.answer || answer;

  const entry = {
    page: 0,
    numberOnPage: 0,
    question,
    options,
    answer: final,
    id: 0,
    sourcePage: page.page,
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

console.log(`${questions.length} câu dựng được`);
console.log(`${skipped.length} trang bỏ qua (trang phân cách / trống)`);
if (problems.length) {
  console.log(`\nCẦN XEM LẠI ${problems.length} câu:`);
  problems.slice(0, 25).forEach((item) => console.log(`  trang ${item.page}: ${item.why} · ${item.question}`));
}

await writeFile(
  REPORT,
  JSON.stringify({ skipped, problems }, null, 2),
  'utf8',
);

if (process.argv.includes('--write')) {
  await writeFile(OUTPUT, `${JSON.stringify(questions, null, 2)}\n`, 'utf8');
  console.log(`\nĐã ghi ${questions.length} câu vào src/data/fer202.json`);
} else {
  console.log('\n(chạy lại với --write để ghi file)');
}
