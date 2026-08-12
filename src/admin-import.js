import { strFromU8, unzipSync } from 'fflate';

const HEADERS = ['subject_id', 'subject_name', 'page', 'number_on_page', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'answer'];
const text = (value) => value == null ? '' : String(value).trim();

function xml(bytes, path) {
  const file = bytes[path];
  if (!file) throw new Error(`File Excel thiếu thành phần ${path}`);
  return new DOMParser().parseFromString(strFromU8(file), 'application/xml');
}

function columnIndex(reference) {
  const letters = String(reference || '').match(/^[A-Z]+/)?.[0] || 'A';
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

export async function readImportFile(file) {
  if (!file || file.size > 5 * 1024 * 1024) throw new Error('File Excel tối đa 5 MB');
  const bytes = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const expandedSize = Object.values(bytes).reduce((total, entry) => total + entry.byteLength, 0);
  if (expandedSize > 25 * 1024 * 1024) throw new Error('Nội dung giải nén quá lớn');

  const workbook = xml(bytes, 'xl/workbook.xml');
  const sheet = [...workbook.getElementsByTagName('sheet')].find((item) => item.getAttribute('name') === 'Questions');
  if (!sheet) throw new Error('Không tìm thấy sheet Questions');
  const relationId = sheet.getAttribute('r:id');
  const relations = xml(bytes, 'xl/_rels/workbook.xml.rels');
  const relation = [...relations.getElementsByTagName('Relationship')].find((item) => item.getAttribute('Id') === relationId);
  const target = relation?.getAttribute('Target')?.replace(/^\//, '');
  if (!target) throw new Error('Không đọc được sheet Questions');
  const worksheet = xml(bytes, target.startsWith('xl/') ? target : `xl/${target}`);
  const shared = bytes['xl/sharedStrings.xml']
    ? [...xml(bytes, 'xl/sharedStrings.xml').getElementsByTagName('si')].map((item) => [...item.getElementsByTagName('t')].map((node) => node.textContent || '').join(''))
    : [];
  const rows = [...worksheet.getElementsByTagName('row')].map((row) => {
    const values = [];
    [...row.getElementsByTagName('c')].forEach((cell) => {
      const type = cell.getAttribute('t');
      const raw = cell.getElementsByTagName('v')[0]?.textContent ?? '';
      values[columnIndex(cell.getAttribute('r'))] = type === 's'
        ? shared[Number(raw)] || ''
        : type === 'inlineStr'
          ? [...cell.getElementsByTagName('t')].map((node) => node.textContent || '').join('')
          : raw;
    });
    return values;
  });
  if (!rows.length) throw new Error('Sheet Questions đang trống');
  const headers = rows[0].map((value) => text(value).toLowerCase());
  const missing = HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Thiếu cột: ${missing.join(', ')}`);
  const col = Object.fromEntries(HEADERS.map((header) => [header, headers.indexOf(header)]));
  const data = rows.slice(1).filter((row) => row.some((value) => text(value)));
  if (!data.length) throw new Error('File chưa có câu hỏi');
  const subjectId = text(data[0][col.subject_id]);
  const subjectName = text(data[0][col.subject_name]);
  const questions = data.map((row, index) => {
    if (text(row[col.subject_id]) !== subjectId || text(row[col.subject_name]) !== subjectName) {
      throw new Error(`Dòng ${index + 2}: mỗi file chỉ chứa một môn`);
    }
    return {
      page: Number(row[col.page]),
      numberOnPage: Number(row[col.number_on_page]),
      question: text(row[col.question]),
      options: { A: text(row[col.option_a]), B: text(row[col.option_b]), C: text(row[col.option_c]), D: text(row[col.option_d]) },
      answer: text(row[col.answer]),
    };
  });
  return { subjectId, subjectName, questions };
}
