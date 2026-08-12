import mongoose from 'mongoose';

const voucherSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
    value: { type: Number, required: true, min: 0 },
    product: { type: String, enum: ['all', 'exam', 'trick'], default: 'all' },
    subject: { type: String, default: '*' },
    usageLimit: { type: Number, default: 0 },
    usedCount: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true },
);

export const Voucher = mongoose.model('Voucher', voucherSchema);
