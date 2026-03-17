# Bot Messenger (meta-messenger.js)

Bot Messenger chạy bằng `meta-messenger.js`, hỗ trợ command runtime, quản trị nhóm, game/tài chính, media (nhạc/video), AI (text + vision), backup dữ liệu tự động, và cơ chế reconnect ổn định.

## Tác giả

- Tác giả chính: **Bảo Kha**
- GitHub: [kha0305](https://github.com/kha0305)
- Repo: [https://github.com/kha0305/bot-mess](https://github.com/kha0305/bot-mess)

## Tính năng chính

- Framework command ESM (`commands/*.js`) + bridge command legacy CJS (`utils/commands/*.cjs`).
- Kết nối Messenger có watchdog/retry/reconnect tự động.
- Hỗ trợ cả luồng thường và E2EE (`message`, `e2eeMessage`, reaction...).
- Lưu dữ liệu bằng SQLite + JSON mirror:
  - `data/database.sqlite`
  - `data/rent_data.json`
  - `data/users.json`
- Backup dữ liệu tự động theo giờ/ngày, có script restore snapshot.
- Bộ command phong phú:
  - Thông tin/tiện ích: `menu`, `help`, `ping`, `info`, `uid`, `math`, `uptime`, `check`...
  - Tài chính/game: `daily`, `balance`, `pay`, `vay`, `work`, `cave`, `tx`, `roll`...
  - Media: `sing`, `video`, `pinterest`, `vd`, `gái`.
  - Quản trị nhóm: `add`, `del`, `qtv`, `qtvonly`, `rename`, `autosend`, `chuiadmin`.
  - Hệ thống/admin: `load`, `reset`, `db`, `ban`, `unban`, `admin`, `note`.

## Yêu cầu hệ thống

- Node.js: khuyến nghị **Node 20 LTS** (project hiện cũng chạy được trên môi trường Node mới).
- OS: Windows/Linux đều chạy được, nhưng một số luồng AI local đang tối ưu cho Windows path.
- Có internet ổn định để bot kết nối Messenger và các API ngoài.

## Cài đặt nhanh

```bash
npm install
```

Chạy bot:

```bash
npm start
```

## Cấu hình bắt buộc

Bot cần file cookie hợp lệ:

- `data/cookies.json`

Tối thiểu cần `c_user` và `xs`:

```json
[
  { "name": "c_user", "value": "YOUR_UID", "domain": ".facebook.com", "path": "/" },
  { "name": "xs", "value": "YOUR_XS", "domain": ".facebook.com", "path": "/" }
]
```

Khuyến nghị thêm cookie `datr`, `fr`, `sb`, `wd` để ổn định hơn.

## Biến môi trường

Không bắt buộc phải có `.env`, bạn có thể set trực tiếp trong môi trường chạy.

### Quyền global bot

- `BOT_SUPERADMINS`
- `BOT_ADMINS`
- `BOT_NDH`

Định dạng: danh sách ID phân tách bằng dấu phẩy.

### Logging / kết nối

- `BOT_DETAILED_LOG` (mặc định `true`)
- `BOT_TRACE_MAX_TEXT`
- `BOT_LOG_LEVEL` (`trace|debug|info|warn|error|none`, mặc định `error`)
- `BOT_VERBOSE_MESSAGE_LOG`
- `BOT_LOG_RESOLVE_SENDER_NAME`
- `BOT_CONNECT_RETRY_MIN_MS`
- `BOT_CONNECT_RETRY_MAX_MS`
- `BOT_CONNECTION_CHECK_INTERVAL_MS`
- `BOT_DISCONNECT_GRACE_MS`

### Backup dữ liệu

- `DATA_BACKUP_INTERVAL_MS`
- `DATA_BACKUP_KEEP_HOURLY`
- `DATA_BACKUP_KEEP_DAILY`
- `DATA_BACKUP_TZ` (mặc định `Asia/Ho_Chi_Minh`)

### AI / Media

- `PICOCLAW_PATH`
- `NOTE_BASE_URL`
- `NOTE_BASE_URLS`
- `NOTE_UPLOAD_TIMEOUT_MS`
- `NOTE_UPLOAD_RETRIES`
- `VIDEO_MAX_BYTES`
- `VIDEO_SEND_RETRIES`
- `VIDEO_SEND_RETRY_DELAY_MS`
- `VIDEO_DEBUG_LOG`
- `SING_DEBUG_LOG`
- `BOT_AUTO_VIDEO_TIMEOUT_MS`
- `BOT_AUTO_VIDEO_MAX_BYTES`

### PayOS (tuỳ chọn)

- `PAYOS_ENABLED`
- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`
- `PAYOS_PORT`

### Core DB sync flags (legacy)

- `FORCE_SYNC`
- `ALTER_SYNC`
- `FALLBACK_FORCE`
- `CHECKTT_CHART_ENABLED`

## Scripts npm

- `npm start`: chạy bot.
- `npm run backup:data`: tạo backup dữ liệu ngay.
- `npm run restore:data -- <args>`: restore từ snapshot.
- `npm run test:smoke`: test smoke runtime.
- `npm run test:all`: test syntax/load/contract/smoke.

## Quản lý backup/restore

Tạo backup:

```bash
npm run backup:data
```

Liệt kê snapshot:

```bash
node scripts/restore-backup.js --list
```

Restore:

```bash
node scripts/restore-backup.js latest
node scripts/restore-backup.js hourly 2026-03-17_21
node scripts/restore-backup.js daily 2026-03-17
```

## Cấu trúc thư mục

```text
.
├─ commands/           # Command ESM
├─ services/bot/       # Runtime + event pipeline
├─ utils/              # Helper, bridge, legacy core commands
├─ scripts/            # Backup/restore/test scripts
├─ data/               # Runtime data (ignored trên git)
├─ index.js            # Entry point
├─ config.js           # Prefix + config bot role
├─ db.js               # SQLite + JSON mirror
└─ interactionDb.js    # DB tương tác nhóm
```

## Bảo mật và chia sẻ mã nguồn

Không commit dữ liệu nhạy cảm:

- `data/cookies.json`
- `data/e2ee_device.json`
- `data/database.sqlite*`
- `data/backups/`
- `e2ee_device.json`

Khi chia sẻ "vỏ sạch", xem tài liệu:

- [HUONG_DAN_SHARE_VO_SACH.md](./HUONG_DAN_SHARE_VO_SACH.md)

## Lỗi thường gặp

- `Không tìm thấy file cookies`
  - Tạo `data/cookies.json` đúng định dạng.

- `cookies thiếu trường bắt buộc`
  - Kiểm tra lại JSON cookie (`c_user`, `xs`).

- Lỗi auth (`redirected to login.php`, `access token is no longer valid`)
  - Cookie đã hết hạn, cần thay cookie mới.

## Nguồn tham khảo

- [meta-messenger.js](https://www.npmjs.com/package/meta-messenger.js)
- [yt-dlp-exec](https://www.npmjs.com/package/yt-dlp-exec)
- [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static)
- [sqlite3](https://www.npmjs.com/package/sqlite3)
- [@payos/node](https://www.npmjs.com/package/@payos/node)

## Ghi chú bản quyền

Mã nguồn thuộc dự án của **Bảo Kha**.  
Khi fork/reuse, vui lòng giữ phần credit tác giả và repo gốc.
