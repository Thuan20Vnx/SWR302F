# Deploy: Vercel (frontend) + Render (backend)

Kiến trúc sau khi deploy:

```
Trình duyệt ──> https://swr302.vercel.app        (Vercel: static site từ Vite)
                      │
                      └── /api/*  ──rewrite──>  https://swr302-api.onrender.com/api/*
                                                (Render: Express + Mongoose)
                                                        │
                                                        └──> MongoDB Atlas
```

Vercel proxy `/api` sang Render nên trình duyệt thấy **cùng một origin**. Nhờ vậy
cookie phiên (`sameSite: lax`, `httpOnly`) hoạt động bình thường và không cần cấu
hình CORS phức tạp. Nếu gọi thẳng `vercel.app → onrender.com` thì cookie sẽ bị
trình duyệt chặn và đăng nhập luôn thất bại.

---

## Bước 1 — MongoDB Atlas (miễn phí)

1. Tạo tài khoản tại https://cloud.mongodb.com → **Build a Database** → chọn gói **M0 Free**.
2. **Database Access** → *Add New Database User*: đặt username/password (password thuần chữ + số cho dễ, tránh ký tự đặc biệt phải escape trong URL).
3. **Network Access** → *Add IP Address* → **Allow access from anywhere** (`0.0.0.0/0`).
   Render dùng IP động nên bắt buộc bước này.
4. **Connect** → *Drivers* → copy connection string, dạng:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/swr302?retryWrites=true&w=majority
   ```
   Nhớ thay `<password>` và thêm `/swr302` (tên database) trước dấu `?`.

## Bước 2 — Google OAuth Client

1. https://console.cloud.google.com → tạo project → **APIs & Services → Credentials**.
2. **Create Credentials → OAuth client ID → Web application**.
3. **Authorized JavaScript origins**, thêm cả 3 (domain Vercel điền sau ở bước 5):
   - `http://localhost:5183`
   - `https://<ten-app>.vercel.app`
4. Không cần *Authorized redirect URIs* — nút đăng nhập dùng Google Identity Services chạy hoàn toàn phía client.
5. Copy **Client ID** (dạng `xxxxx.apps.googleusercontent.com`).

## Bước 3 — Deploy backend lên Render

1. https://dashboard.render.com → **New → Web Service** → kết nối repo `Thuan20Vnx/SWR302F`.
2. Cấu hình:

   | Mục | Giá trị |
   |---|---|
   | Root Directory | `server` |
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Health Check Path | `/api/health` |
   | Instance Type | Free |

3. **Environment Variables**:

   | Key | Value |
   |---|---|
   | `MONGODB_URI` | connection string ở bước 1 |
   | `GOOGLE_CLIENT_ID` | Client ID ở bước 2 |
   | `JWT_SECRET` | chuỗi ngẫu nhiên dài (đã có sẵn trong `server/.env` ở máy bạn) |
   | `CLIENT_ORIGIN` | `https://<ten-app>.vercel.app` (điền sau bước 5) |
   | `NODE_ENV` | `production` |
   | `MAX_DEVICES` | `3` |

   `NODE_ENV=production` là bắt buộc — nó bật cờ `secure` cho cookie phiên.
   **Đừng** set `PORT`, Render tự cấp.

4. Deploy xong, copy URL dạng `https://swr302-api.onrender.com` và kiểm tra:
   ```
   https://swr302-api.onrender.com/api/health   →   {"ok":true}
   ```

## Bước 4 — Trỏ proxy sang Render

Sửa [`vercel.json`](vercel.json), thay `TEN-SERVICE-CUA-BAN` bằng tên service Render thật:

```json
"destination": "https://swr302-api.onrender.com/api/:path*"
```

Rồi commit và push:

```bash
git add vercel.json && git commit -m "Point API proxy at Render" && git push
```

## Bước 5 — Deploy frontend lên Vercel

1. https://vercel.com/new → import repo `Thuan20Vnx/SWR302F`.
2. Framework Preset **Vite**, Root Directory để trống (thư mục gốc).
   Build command / output directory đã khai trong `vercel.json`, không cần sửa.
3. **Environment Variables** → thêm:

   | Key | Value |
   |---|---|
   | `VITE_GOOGLE_CLIENT_ID` | đúng Client ID ở bước 2 |

   Biến `VITE_*` được nhúng vào bundle lúc build, nên **đổi giá trị là phải deploy lại**.
4. Deploy → nhận domain `https://<ten-app>.vercel.app`.

## Bước 6 — Nối lại hai đầu

Sau khi có domain Vercel thật, quay lại cập nhật:

- **Google Console** → thêm `https://<ten-app>.vercel.app` vào *Authorized JavaScript origins*.
- **Render** → sửa biến `CLIENT_ORIGIN` thành domain đó → service tự restart.

---

## Kiểm tra sau khi deploy

1. Mở `https://<ten-app>.vercel.app` → chọn trang, tìm kiếm, lật thẻ hoạt động (phần này chạy offline hoàn toàn).
2. `https://<ten-app>.vercel.app/api/health` → `{"ok":true}` (chứng tỏ proxy chạy).
3. Đăng nhập Google → hiện avatar + tên.
4. Đánh dấu vài câu **Đã thuộc** và **Lưu câu hỏi**, chờ ~1 giây, F5 lại trang → dữ liệu còn nguyên.
5. Mở trên điện thoại, đăng nhập cùng tài khoản → tiến độ từ máy tính hiện sang.
6. Kiểm tra DB: Atlas → *Browse Collections* → `swr302.users` → thấy `progress`, `savedQuestions`.

## Những chỗ hay vướng

| Triệu chứng | Nguyên nhân |
|---|---|
| Nút đăng nhập Google không hiện | Thiếu `VITE_GOOGLE_CLIENT_ID` lúc build, hoặc domain chưa có trong *Authorized JavaScript origins* |
| Đăng nhập xong F5 lại mất phiên | `vercel.json` chưa trỏ đúng Render, hoặc thiếu `NODE_ENV=production` |
| `/api/health` trả 404 | Rewrite trong `vercel.json` sai URL, hoặc chưa push file lên GitHub |
| Request đầu tiên chờ ~50 giây | Render gói Free ngủ sau 15 phút không có traffic — bình thường, lần sau nhanh lại |
| Render log `Failed to connect to MongoDB` | Chưa mở `0.0.0.0/0` trong Network Access, hoặc password trong URI chưa được URL-encode |
| Đăng nhập máy thứ 4 làm máy cũ văng ra | Đúng thiết kế: `MAX_DEVICES=3`, thiết bị lâu không dùng nhất bị đá |

## Ghi chú

- `.env` và `server/.env` nằm trong `.gitignore` — biến môi trường chỉ khai trên dashboard của Vercel/Render, đừng commit.
- Mỗi lần push lên `main`, cả Vercel lẫn Render đều tự deploy lại.
- Tiến độ vẫn lưu trong `localStorage` khi backend chết, nên Render ngủ cũng không làm app hỏng — chỉ là không đồng bộ đa thiết bị cho tới khi server tỉnh.
