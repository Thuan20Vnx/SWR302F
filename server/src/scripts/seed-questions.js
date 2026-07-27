// Nạp bộ câu hỏi từ src/questions.json vào MongoDB.
// Chạy: npm run seed  (trong thư mục server)
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDB } from '../db.js';
import { Question } from '../models/Question.js';

const source = fileURLToPath(new URL('../../../src/questions.json', import.meta.url));
const questions = JSON.parse(await readFile(source, 'utf8'));

if (!Array.isArray(questions) || !questions.length) {
  throw new Error(`Không đọc được câu hỏi nào từ ${source}`);
}

await connectDB();

const result = await Question.bulkWrite(
  questions.map((question) => ({
    updateOne: {
      filter: { id: question.id },
      // duplicateOf phải được ghi rõ, nếu không câu vừa hết trùng sẽ giữ giá trị cũ.
      update: { $set: { duplicateOf: null, ...question } },
      upsert: true,
    },
  })),
);

const total = await Question.countDocuments();
console.log(
  `Đã nạp ${questions.length} câu từ questions.json ` +
    `(thêm mới ${result.upsertedCount}, cập nhật ${result.modifiedCount}). ` +
    `Tổng trong DB: ${total}`,
);

await mongoose.disconnect();
