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
    // Gạch dưới nằm lọt giữa một hộp chữ: ước lượng vị trí ký tự theo bề ngang
    // trung bình của chữ. Bề ngang của chính chỗ trống không mang chữ nào nên
    // phải trừ ra, nếu không vị trí cắt sẽ lệch về sau.
    const blankWidth = blank.x2 - blank.x;
    const textWidth = Math.max(inside.x2 - inside.x - blankWidth, 1);
    const ratio = (blank.x - inside.x) / textWidth;
    const cut = Math.round(ratio * inside.text.length);
    const space = inside.text.lastIndexOf(' ', cut);
    const at = space > 0 ? space : cut;
    // Các mảnh phải mang toạ độ mới, nếu không chỗ trống tiếp theo trên cùng
    // dòng sẽ so vào khung cũ và chèn sai chỗ.
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
      const boxes = lines
        .sort((a, b) => a.x - b.x)
        .map((line) => ({ x: line.x, x2: line.x2 ?? line.x, text: line.text.trim() }));
      cluster.readings.push({
        boxes,
        text: boxes.map((box) => box.text).join(' '),
        // Bản OCR chạy trước khi script lưu bề ngang hộp chữ thì không dùng để
        // đặt chỗ trống được.
        hasWidth: lines.every((line) => line.x2 !== undefined),
      });
    }
  }

  // Chỗ trống rơi xuống dòng riêng (không có chữ nào cùng dòng) thì không có
  // cụm nào nhận, phải tự thành một dòng.
  for (const blank of blanks) {
    if (!clusters.some((cluster) => Math.abs(blank.y - cluster.y) <= 16)) {
      // Cụm rỗng: bước chèn ngay bên dưới sẽ đặt chỗ trống vào, tránh chèn hai lần.
      clusters.push({ y: blank.y, readings: [{ boxes: [], text: '', hasWidth: true }] });
    }
  }

  return clusters
    .sort((a, b) => a.y - b.y)
    .map((cluster) => {
      // Chỗ trống của dòng nào thì chèn vào dòng đó, chèn từ phải sang trái để
      // các vị trí phía trước không bị xê dịch.
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

// Câu lấy text sạch từ bộ đề cũ thì bộ đó không có chỗ trống; chuyển vị trí
// chỗ trống từ bản OCR sang bằng cách bám vào từ đứng ngay trước nó.
function transferBlanks(fromText, toText) {
  if (!fromText.includes(BLANK) || toText.includes(BLANK)) return toText;

  // Bản OCR hay mất dấu cách nên không so khớp theo từ được. Hai câu là cùng một
  // câu nên đếm số ký tự chữ-số đứng trước chỗ trống là đủ để đặt lại đúng vị
  // trí, rồi lùi về ranh giới từ gần nhất của bản sạch.
  const alnum = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '').length;

  const positions = [];
  let counted = 0;
  for (const part of fromText.split(BLANK).slice(0, -1)) {
    counted += alnum(part);
    positions.push(counted);
  }

  const out = [];
  let seen = 0;
  let next = 0;
  for (const word of toText.split(/\s+/).filter(Boolean)) {
    while (next < positions.length && positions[next] <= seen) {
      out.push(BLANK);
      next += 1;
    }
    out.push(word);
    seen += alnum(word);
  }
  // Chỉ một chỗ trống được phép nằm sau chữ cuối; nhiều hơn thế là dò nhầm nét
  // vẽ trong hình minh hoạ của đề.
  if (next < positions.length) out.push(BLANK);
  return out.join(' ');
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
const replaced = [];
let fromBank = 0;

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

  const match = bank.get(norm(parsed.question).slice(0, 60));
  if (match) fromBank += 1;

  // Ghi chú tay là chuẩn cuối cùng, đè lên cả OCR lẫn text của bộ cũ.
  const question = scrub(
    manual?.question ||
      (match ? transferBlanks(parsed.question, match.question) : parsed.question),
  );
  const options = Object.fromEntries(
    Object.entries({
      ...(match
        ? Object.fromEntries(
            Object.entries(match.options).map(([letter, text]) => [
              letter,
              transferBlanks(parsed.options.get(letter) || '', text),
            ]),
          )
        : Object.fromEntries(parsed.options)),
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

  // Bộ đề cũ thỉnh thoảng bị OCR kéo nội dung câu sau vào lựa chọn cuối. Ảnh
  // chụp mới nét hơn nên chỗ nào bộ cũ dài hơn hẳn là chỗ đó có rác.
  if (match) {
    for (const [letter, text] of Object.entries(options)) {
      const fresh = (parsed.options.get(letter) || '').replace(/[^a-z0-9]/gi, '');
      const old = text.replace(/[^a-z0-9]/gi, '');
      if (!fresh || old.length <= fresh.length * 1.4 + 25) continue;

      const clean = scrub(parsed.options.get(letter));
      // Bản mới cũng có thể bị dính chữ; khi đó phải chép tay chứ không thay bừa.
      if (/[A-Za-z]{16,}/.test(clean)) {
        problems.push({
          page: page.page,
          why: `lựa chọn ${letter} của bộ cũ dính chữ câu sau, bản OCR mới lại mất dấu cách`,
          question: clean.slice(0, 80),
        });
        continue;
      }
      options[letter] = clean;
      replaced.push({ page: page.page, letter, from: text.slice(0, 60), to: clean });
    }
  }

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
if (replaced.length) {
  console.log(`
${replaced.length} lựa chọn lấy lại từ ảnh chụp mới (bộ cũ dính chữ của câu sau):`);
  replaced.forEach((item) =>
    console.log(`  trang ${item.page} · ${item.letter}: "${item.from}..." -> "${item.to}"`),
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
