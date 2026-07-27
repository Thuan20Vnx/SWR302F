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

// URI dạng ".../?retryWrites=true" (không có tên database) sẽ khiến Mongoose ghi
// vào DB mặc định là "test". Khi đó tự chỉ định tên database cho chắc.
function databaseFromUri(uri) {
  const path = uri.split('://')[1]?.split('@').pop().split('?')[0] || '';
  const name = path.split('/')[1];
  return name || '';
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI in environment');
  await ensureSrvResolvable(uri);

  const options = {};
  if (!databaseFromUri(uri)) {
    options.dbName = process.env.MONGODB_DB || 'swr302';
    console.warn(`MONGODB_URI has no database name; using "${options.dbName}"`);
  }

  await mongoose.connect(uri, options);
  console.log(`MongoDB connected (db: ${mongoose.connection.name})`);
}
