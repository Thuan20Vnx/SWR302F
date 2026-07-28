// Nạp bộ câu hỏi của mọi môn trong src/data/subjects.json vào MongoDB.
// Chạy: npm run seed  (trong thư mục server)
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDB } from '../db.js';
import { Question } from '../models/Question.js';

const dataDir = new URL('../../../src/data/', import.meta.url);
const readJson = async (name) =>
  JSON.parse(await readFile(fileURLToPath(new URL(name, dataDir)), 'utf8'));

const subjects = await readJson('subjects.json');

await connectDB();

for (const subject of subjects) {
  const questions = await readJson(subject.file);
  if (!Array.isArray(questions) || !questions.length) {
    throw new Error(`Không đọc được câu hỏi nào từ ${subject.file}`);
  }

  const result = await Question.bulkWrite(
    questions.map((question) => ({
      updateOne: {
        filter: { id: question.id },
        // duplicateOf phải được ghi rõ, nếu không câu vừa hết trùng sẽ giữ giá trị cũ.
        update: { $set: { duplicateOf: null, ...question, subject: subject.id } },
        upsert: true,
      },
    })),
  );

  // Đề luôn được dựng lại từ file nguồn, nên câu nào không còn trong file là
  // rác của lần nạp trước.
  const stale = await Question.deleteMany({
    subject: subject.id,
    id: { $nin: questions.map((question) => question.id) },
  });

  console.log(
    `${subject.id}: ${questions.length} câu ` +
      `(thêm ${result.upsertedCount}, cập nhật ${result.modifiedCount}, xoá ${stale.deletedCount})`,
  );
}

console.log(`Tổng trong DB: ${await Question.countDocuments()}`);

await mongoose.disconnect();
