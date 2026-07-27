import dns from 'node:dns';
import mongoose from 'mongoose';

// Chuỗi mongodb+srv:// cần tra cứu bản ghi SRV. Một số DNS của ISP từ chối loại
// truy vấn này (Node trả ECONNREFUSED) trong khi vẫn phân giải tên miền bình
// thường. Khi đó chèn DNS công cộng lên đầu danh sách rồi thử lại.
async function ensureSrvResolvable(uri) {
  if (!uri.startsWith('mongodb+srv://')) return;

  const host = uri.split('@').pop().split(/[/?]/)[0];
  if (!host) return;

  try {
    await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
  } catch (error) {
    const fallback = (process.env.DNS_FALLBACK || '8.8.8.8,1.1.1.1')
      .split(',')
      .map((server) => server.trim())
      .filter(Boolean);
    console.warn(
      `SRV lookup failed (${error.code}); retrying via ${fallback.join(', ')}`,
    );
    dns.setServers([...fallback, ...dns.getServers()]);
  }
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI in environment');
  await ensureSrvResolvable(uri);
  await mongoose.connect(uri);
  console.log('MongoDB connected');
}
