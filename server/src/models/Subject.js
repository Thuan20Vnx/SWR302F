import mongoose from 'mongoose';

const subjectSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    label: { type: String, required: true },
    questionCount: { type: Number, default: 0 },
    importedBy: { type: String, default: '' },
    examPrice: { type: Number, default: 20_000 },
    trickPrice: { type: Number, default: 20_000 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Subject = mongoose.model('Subject', subjectSchema);
