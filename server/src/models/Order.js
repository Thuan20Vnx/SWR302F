import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true },
    subject: { type: String, required: true },
    product: { type: String, enum: ['exam', 'trick'], required: true },
    originalPrice: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    finalPrice: { type: Number, required: true },
    voucherCode: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'active', 'cancelled'], default: 'pending' },
    activatedBy: { type: String, default: '' },
  },
  { timestamps: true },
);

export const Order = mongoose.model('Order', orderSchema);
