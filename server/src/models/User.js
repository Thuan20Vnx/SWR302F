import mongoose from 'mongoose';

const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true },
    userAgent: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// Bài thi thử đang làm dở, lưu theo môn để đổi thiết bị vẫn làm tiếp được.
const examSessionSchema = new mongoose.Schema(
  {
    subject: { type: String, default: '' },
    mode: { type: String, enum: ['practice', 'full'], default: 'practice' },
    // Thứ tự câu đã bốc - phải giữ nguyên, nếu không vào lại là đề khác.
    ids: { type: [Number], default: [] },
    index: { type: Number, default: 0 },
    // Mỗi phần tử là các chữ cái đã chọn của câu đó, ví dụ "" hoặc "BD".
    answers: { type: [String], default: [] },
    checked: { type: [Boolean], default: [] },
    // Mốc hết giờ tuyệt đối (epoch ms) nên đóng app đồng hồ vẫn chạy đúng.
    deadline: { type: Number, default: 0 },
    startedAt: { type: Number, default: 0 },
    updatedAt: { type: Number, default: 0 },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: { type: String, default: '' },
    picture: { type: String, default: '' },
    devices: { type: [deviceSchema], default: [] },
    // { "<questionId>": "known" | "again" }
    progress: { type: Map, of: String, default: () => new Map() },
    savedQuestions: { type: [Number], default: [] },
    sessions: { type: Number, default: 0 },
    // YYYY-MM-DD the session counter belongs to
    sessionsDate: { type: String, default: '' },
    // { "<subject>": examSession }
    examSessions: {
      type: Map,
      of: examSessionSchema,
      default: () => new Map(),
    },
    progressUpdatedAt: { type: Date, default: Date.now },
    stars: { type: Map, of: Number, default: () => new Map() },
    highlights: { type: Map, of: [String], default: () => new Map() },
    entitlements: {
      examSubjects: { type: [String], default: [] },
      trickSubjects: { type: [String], default: [] },
      examAttempts: { type: Number, default: 1 },
      isExamUnlimited: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', userSchema);
