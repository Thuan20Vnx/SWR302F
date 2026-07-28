import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    // Mã môn trong src/data/subjects.json. Mỗi môn dùng một dải id riêng nên id
    // vẫn là duy nhất trên toàn bộ collection.
    subject: { type: String, required: true, index: true, default: 'SWR302Sample' },
    page: { type: Number, required: true, index: true },
    numberOnPage: { type: Number, required: true },
    question: { type: String, required: true },
    // { "A": "...", "B": "..." }
    options: { type: Map, of: String, required: true },
    // Chuỗi các chữ cái đúng, ví dụ "B" hoặc "BD"
    answer: { type: String, required: true },
    // Câu lặp lại của đề khác: id của câu xuất hiện đầu tiên. null nếu là bản gốc.
    duplicateOf: { type: Number, default: null },
  },
  { timestamps: true },
);

export const Question = mongoose.model('Question', questionSchema);
