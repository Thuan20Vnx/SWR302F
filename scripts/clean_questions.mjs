// Làm sạch text thừa do OCR trong src/questions.json.
// Chạy: node scripts/clean_questions.mjs [--write]
//
// Nguồn PDF có phần đáp án + giải thích tiếng Việt nằm ngay dưới mỗi câu, OCR
// kéo chúng dính vào lựa chọn cuối. Ngoài ra còn dấu tick "iV)" và ký tự lạ.
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../src/questions.json', import.meta.url);

// "... iv) BC@Epics chia nhỏ ..." - từ dấu @ trở đi là chú thích của người soạn.
const AT_BLOCK = /\s*[A-Za-z0-9]{0,6}@[\s\S]*$/;
// Dấu tick OCR đọc nhầm ở cuối dòng: "iV)", "V)", "(V)", "0)", "(9)", "é"
const TRAILING_ARTIFACT =
  /(?:\s*[([]?\s*(?:[iIvVxX]{1,3}|\d)\s*[)\]]|\s+é|\s+[iIvV]{1,3})\s*$/;

// Những chỗ quy tắc chung không xử lý an toàn được, sửa tay theo đúng nguồn OCR.
const OVERRIDES = {
  // Đuôi bị OCR đọc thành chuỗi vô nghĩa.
  6: { options: { C: 'It reduces the need for stakeholder involvement' } },
  // OCR dính mạo từ "A" vào "use case".
  17: {
    options: {
      A: 'A use case describes a sequence of interactions between a system and an external actor that results in an outcome of value to the actor.',
    },
  },
  55: {
    options: {
      D: 'A use case describes a sequence of interactions between a system and an external actor that results in the actor being able to achieve some outcome of value',
    },
  },
  // OCR đọc nát dòng "(Choose 3 correct answers)"; bản trùng ở trang 13 đọc rõ.
  45: { question: 'Requirement statements must be: (Choose 3 correct answers)' },
  // Phần giải thích tiếng Việt dính vào sau lựa chọn. Chữ cái thừa trong đáp án
  // ("DA", "CA") cũng do OCR; phần dịch trong nguồn ghi rõ đáp án là D và C.
  67: { answer: 'D', options: { E: 'Elicit requirements' } },
  71: { answer: 'C', options: { D: 'Includes direct users and indirect users' } },
  // Câu hỏi gốc bị mất khi sang trang; khôi phục từ phần dịch trong nguồn:
  // "Trong biểu đồ Swimlane, các bước của quy trình được thể hiện bằng gì?"
  105: {
    question:
      'In a swimlane diagram, what are the steps of the process represented by?',
  },
  112: { options: { D: "Must, Shall, Could, Won't" } },
  140: { options: { D: 'Ignoring minor risks and focusing only on major risks' } },
  151: { options: { D: 'By eliminating non-functional requirements' } },
  176: {
    options: { D: 'Only review requirements after the development phase.' },
  },
  // Đầu câu dính phần dịch của câu trước.
  200: {
    question:
      'External quality attributes describe characteristics that are observed when the software is executing. Which following definitions is Integrity?',
  },
  288: { options: { E: 'Computations' } },
  338: {
    options: {
      D: 'Validation is about internal testing, while verification is about external approval',
    },
  },
  365: {
    options: {
      D: 'Requirements written in natural language are ambiguities, missing information, and hidden assumptions',
    },
  },
  367: {
    options: {
      D: "let's you explore some specific behaviors of the intended system, with the goal of refining the requirements",
    },
  },
};

const VIETNAMESE =
  /[éèêáàâíìóòôúùơưđăĩũỹạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

function scrub(text) {
  let value = text.replace(AT_BLOCK, '');
  let previous;
  do {
    previous = value;
    value = value.replace(TRAILING_ARTIFACT, '');
  } while (value !== previous);
  return value.replace(/\s+/g, ' ').trim();
}

const questions = JSON.parse(await readFile(FILE, 'utf8'));
const changes = [];

for (const item of questions) {
  const override = OVERRIDES[item.id] || {};

  const question = override.question ?? scrub(item.question);
  if (question !== item.question) {
    changes.push({ id: item.id, field: 'question', from: item.question, to: question });
    item.question = question;
  }

  const answer = override.answer ?? item.answer;
  if (answer !== item.answer) {
    changes.push({ id: item.id, field: 'answer', from: item.answer, to: answer });
    item.answer = answer;
  }

  for (const [letter, text] of Object.entries(item.options)) {
    const cleaned = override.options?.[letter] ?? scrub(text);
    if (cleaned !== text) {
      changes.push({ id: item.id, field: `option ${letter}`, from: text, to: cleaned });
      item.options[letter] = cleaned;
    }
  }
}

// Kiểm tra lại: không còn tiếng Việt, không còn lựa chọn rỗng, đáp án vẫn hợp lệ.
const problems = [];
for (const item of questions) {
  const fields = [['question', item.question], ...Object.entries(item.options)];
  for (const [name, text] of fields) {
    if (VIETNAMESE.test(text)) problems.push(`id${item.id} ${name}: còn tiếng Việt`);
    if (!text.trim()) problems.push(`id${item.id} ${name}: rỗng`);
  }
  for (const letter of item.answer.split('')) {
    if (!(letter in item.options)) {
      problems.push(`id${item.id}: đáp án ${letter} không có trong lựa chọn`);
    }
  }
}

console.log(`Đã sửa ${changes.length} chuỗi trên ${new Set(changes.map((c) => c.id)).size} câu`);
for (const change of changes.slice(0, 12)) {
  console.log(`  id${change.id} ${change.field}`);
  console.log(`    - ${change.from.slice(0, 110)}`);
  console.log(`    + ${change.to.slice(0, 110)}`);
}
if (changes.length > 12) console.log(`  ... và ${changes.length - 12} chuỗi nữa`);

console.log(problems.length ? `\nVẤN ĐỀ CÒN LẠI (${problems.length}):` : '\nKhông còn vấn đề nào.');
problems.forEach((problem) => console.log('  ' + problem));

if (process.argv.includes('--write')) {
  await writeFile(FILE, JSON.stringify(questions, null, 2) + '\n', 'utf8');
  console.log('\nĐã ghi src/questions.json');
} else {
  console.log('\n(chạy lại với --write để ghi file)');
}
