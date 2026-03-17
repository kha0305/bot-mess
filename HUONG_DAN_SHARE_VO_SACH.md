# Hướng Dẫn Share Vỏ Sạch (khác tài khoản)

Tài liệu này dùng cho trường hợp bạn cho người khác "mượn vỏ" bot để chạy bằng tài khoản Messenger của họ.

## 1) Mục tiêu

- Share source bot.
- Không lộ thông tin nhạy cảm của bạn.
- Người nhận tự đăng nhập tài khoản của họ.

## 2) Gói vỏ sạch cần có

Gói vỏ sạch nên gồm:

- `commands/`
- `services/`
- `utils/`
- `scripts/`
- `index.js`
- `config.js`
- `db.js`
- `interactionDb.js`
- `migrate_apis.js`
- `package.json`
- `package-lock.json`
- `HUONG_DAN_SHARE_VO_SACH.md`

## 3) Tuyệt đối KHÔNG share

- `node_modules/`
- `data/cookies.json`
- `data/e2ee_device.json`
- `data/database.sqlite`
- `data/database.sqlite-wal`
- `data/database.sqlite-shm`
- `data/backups/`
- `e2ee_device.json` (root)

## 4) Người nhận cần làm gì trên máy của họ

1. Cài Node.js (khuyến nghị Node 20 LTS).
2. Giải nén gói zip vào 1 thư mục riêng.
3. Mở terminal tại thư mục đó.
4. Cài package:

```powershell
npm install
```

5. Tạo file `data/cookies.json` bằng cookie tài khoản của người nhận.
6. Chạy bot:

```powershell
npm start
```

## 5) Mẫu `data/cookies.json` tối thiểu

Bot hỗ trợ định dạng mảng JSON cookie object. Tối thiểu cần có `c_user` và `xs`.

```json
[
  { "name": "c_user", "value": "YOUR_UID", "domain": ".facebook.com", "path": "/" },
  { "name": "xs", "value": "YOUR_XS", "domain": ".facebook.com", "path": "/" }
]
```

Khuyến nghị thêm: `datr`, `fr`, `sb`, `wd` để phiên ổn định hơn.

## 6) Lỗi thường gặp và cách xử lý nhanh

- Lỗi: `Không tìm thấy file cookies`
  - Tạo lại file `data/cookies.json`.

- Lỗi: `cookies thiếu trường bắt buộc`
  - Kiểm tra lại JSON và cookie `c_user`, `xs`.

- Lỗi liên quan `login.php` hoặc `token no longer valid`
  - Cookie hết hạn, cần lấy cookie mới rồi chạy lại.

## 7) Nguyên tắc vận hành

- Mỗi người 1 bộ cookie riêng.
- Không chạy chung 1 tài khoản trên nhiều máy cùng lúc.
- Mỗi bộ bot nên chạy trong 1 folder riêng (tách riêng thư mục `data/`).
