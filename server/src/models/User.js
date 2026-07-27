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
    progressUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', userSchema);
