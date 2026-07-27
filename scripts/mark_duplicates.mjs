// Đánh dấu các câu hỏi lặp lại trong đề (các đề FA25/SP26 dùng chung nhiều câu).
// Chạy: node scripts/mark_duplicates.mjs [--write]
//
// Câu xuất hiện đầu tiên (id nhỏ nhất) là bản gốc; các bản sau nhận trường
// duplicateOf trỏ về nó. Không xoá câu nào, chỉ gắn nhãn.
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../src/questions.json', import.meta.url);

// OCR làm lệch dấu nháy và đôi khi thêm/bớt mạo từ, nên chỉ so 80 ký tự
// chữ-số đầu tiên. Đáp án và số lựa chọn phải khớp để tránh gom nhầm.
const KEY_LENGTH = 80;
const keyOf = (item) =>
  [
    item.question.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, KEY_LENGTH),
    item.answer,
    Object.keys(item.options).length,
  ].join('|');

const questions = JSON.parse(await readFile(FILE, 'utf8'));

const groups = new Map();
for (const item of questions) {
  const key = keyOf(item);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(item);
}

let marked = 0;
const duplicateGroups = [];

for (const group of groups.values()) {
  group.sort((a, b) => a.id - b.id);
  const [original, ...copies] = group;
  delete original.duplicateOf;

  if (!copies.length) continue;
  duplicateGroups.push(group);

  for (const copy of copies) {
    copy.duplicateOf = original.id;
    marked += 1;
  }
}

// Cảnh báo nếu độ dài câu trong cùng nhóm lệch nhau nhiều - dấu hiệu gom nhầm.
const suspicious = duplicateGroups.filter((group) => {
  const lengths = group.map((item) => item.question.length);
  return Math.max(...lengths) - Math.min(...lengths) > 40;
});

console.log(`${duplicateGroups.length} nhóm trùng · ${marked} câu được đánh dấu là bản lặp`);
console.log(`Còn ${questions.length - marked} câu gốc trên tổng ${questions.length}`);

const spread = duplicateGroups.slice(0, 5);
console.log('\nVí dụ:');
for (const group of spread) {
  console.log(
    `  ${group.map((item) => `id${item.id}(t${item.page})`).join(' = ')} :: ${group[0].question.slice(0, 62)}`,
  );
}

if (suspicious.length) {
  console.log(`\nCẦN XEM LẠI ${suspicious.length} nhóm có độ dài lệch nhau:`);
  suspicious.forEach((group) => {
    group.forEach((item) => console.log(`  id${item.id}: ${item.question.slice(0, 100)}`));
    console.log('');
  });
}

if (process.argv.includes('--write')) {
  await writeFile(FILE, JSON.stringify(questions, null, 2) + '\n', 'utf8');
  console.log('\nĐã ghi src/questions.json');
} else {
  console.log('\n(chạy lại với --write để ghi file)');
}
