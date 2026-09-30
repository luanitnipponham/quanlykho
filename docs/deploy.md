# TRIỂN KHAI BẰNG DOCKER TRÊN LINUX (v3.4)

> Tổng quan hệ thống: [doc.md](doc.md) · An ninh: [security.md](security.md)
> Cập nhật: 2026-09-29

---

## 1. Kiến trúc khi chạy Docker

```
                    ┌──────────────────────────────────────────┐
   Trình duyệt ───▶ │  web (nginx)            cổng 80          │
                    │   • phục vụ giao diện đã build (tĩnh)    │
                    │   • /api/*  ──proxy──▶  api:3000         │
                    └───────────────┬──────────────────────────┘
                                    │ mạng nội bộ của compose
                    ┌───────────────▼──────────────────────────┐
                    │  api (NestJS + Prisma)   cổng 3000       │
                    │   • volume: storage  → /app/storage      │
                    └───────────────┬──────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────────┐
                    │  db (PostgreSQL 18)      cổng 5432       │
                    │   • volume: db-data                      │
                    └──────────────────────────────────────────┘
```

**Chỉ container `web` mở cổng ra ngoài.** `api` và `db` nằm trong mạng nội bộ, không truy cập trực tiếp từ bên ngoài được.

Hai volume giữ dữ liệu sống qua các lần dựng lại container:

| Volume | Chứa gì | Mất volume này nghĩa là |
| :-- | :-- | :-- |
| `db-data` | Toàn bộ cơ sở dữ liệu | Mất mọi phiếu, người dùng, lịch sử |
| `storage` | Cây `CHUNG_TU/` — tệp đính kèm | Mất mọi file đã upload |

---

## 2. Yêu cầu máy chủ

- Linux 64-bit (Ubuntu 22.04 / Debian 12 trở lên là đủ).
- Docker Engine 24+ và Docker Compose v2 (`docker compose`, không phải `docker-compose` cũ).
- Tối thiểu 2 GB RAM, 10 GB đĩa trống. Lần build đầu cần mạng để tải image và gói npm.

Kiểm tra:
```bash
docker --version && docker compose version
```

---

## 3. Triển khai lần đầu

```bash
# 1. Chép mã nguồn lên máy chủ rồi vào thư mục dự án
cd /opt/quanlykho

# 2. Tạo file cấu hình từ mẫu
cp deploy/app.env.example deploy/app.env

# 3. Sinh mật khẩu và khóa JWT thật
openssl rand -base64 24   # dùng cho POSTGRES_PASSWORD
openssl rand -base64 48   # dùng cho JWT_SECRET

# 4. Sửa deploy/app.env
nano deploy/app.env

# 5. Dựng và chạy
docker compose up -d --build

# 6. Theo dõi tới khi thấy "Khởi động API..."
docker compose logs -f api
```

Mở `http://<địa-chỉ-máy-chủ>/`.

### Bắt buộc sửa trong `deploy/app.env`

| Biến | Ghi chú |
| :-- | :-- |
| `POSTGRES_PASSWORD` | Đặt mật khẩu mạnh |
| `DATABASE_URL` | Phải chứa đúng mật khẩu vừa đặt; giữ nguyên host `db` |
| `JWT_SECRET` | **Bắt buộc đổi.** Để nguyên giá trị mẫu là lỗ hổng nghiêm trọng |
| `SEED_PASSWORD` | Mật khẩu của 5 tài khoản mẫu tạo lần đầu |

Lần chạy đầu, container `api` tự động: chờ PostgreSQL → áp migration → nạp dữ liệu mẫu **nếu cơ sở dữ liệu còn trống**. Những lần sau nó thấy đã có dữ liệu và bỏ qua bước nạp, nên không bao giờ ghi đè dữ liệu thật.

Sau khi đăng nhập lần đầu, hệ thống bắt đổi mật khẩu. Nên đổi hết 5 tài khoản mẫu rồi xóa những tài khoản không dùng.

---

## 4. Vận hành hằng ngày

| Việc | Lệnh |
| :-- | :-- |
| Xem trạng thái | `docker compose ps` |
| Xem log | `docker compose logs -f api` (hoặc `web`, `db`) |
| Khởi động lại | `docker compose restart api` |
| Tắt (giữ dữ liệu) | `docker compose down` |
| Bật lại | `docker compose up -d` |
| Cập nhật mã nguồn mới | `git pull && docker compose up -d --build` |
| Vào psql | `docker compose exec db psql -U quanlykho -d quanlykho` |

> `docker compose down -v` **xóa cả volume** — mất toàn bộ dữ liệu và file đính kèm. Chỉ dùng khi thật sự muốn làm lại từ đầu.

---

## 5. Sao lưu và khôi phục

Sao lưu cả hai thứ — chỉ một trong hai là không đủ.

```bash
# Sao lưu cơ sở dữ liệu
docker compose exec -T db pg_dump -U quanlykho quanlykho | gzip > backup-db-$(date +%F).sql.gz

# Sao lưu tệp đính kèm
docker run --rm -v quanlykho-main_storage:/data -v "$PWD":/backup alpine \
  tar czf /backup/backup-files-$(date +%F).tar.gz -C /data .
```

Khôi phục:
```bash
gunzip -c backup-db-2026-09-29.sql.gz | docker compose exec -T db psql -U quanlykho -d quanlykho

docker run --rm -v quanlykho-main_storage:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/backup-files-2026-09-29.tar.gz -C /data"
```

Tên volume phụ thuộc tên thư mục dự án. Xem chính xác bằng `docker volume ls`.

Nên đặt lịch cron chạy sao lưu hằng ngày và **thử khôi phục định kỳ** — bản sao lưu chưa từng khôi phục thử thì chưa chắc dùng được.

---

## 6. Đưa ra Internet: bắt buộc thêm HTTPS

Cấu hình hiện tại chạy HTTP, phù hợp mạng nội bộ. Nếu mở ra Internet, **bắt buộc** đặt một reverse proxy có TLS phía trước (Caddy, Traefik hoặc nginx + certbot).

Ví dụ với Caddy — sửa `docker-compose.yml` cho `web` không mở cổng 80 ra ngoài nữa, rồi:

```caddyfile
phieuchi.congty.vn {
    reverse_proxy web:80
}
```

Sau khi có HTTPS, nhớ đặt `CORS_ORIGIN=https://phieuchi.congty.vn` trong `deploy/app.env`.

Những việc còn lại trước khi chạy thật nằm ở [security.md §8](security.md): rate limiting, security headers ngoài phần nginx đã có, thu hồi quyền xóa trên bảng nhật ký.

---

## 7. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
| :-- | :-- | :-- |
| Trang báo **"Không kết nối được máy chủ"** | Container `api` chưa chạy hoặc lỗi kết nối CSDL | `docker compose ps` rồi `docker compose logs api` |
| `api` khởi động lại liên tục | `DATABASE_URL` sai mật khẩu hoặc sai tên database | So lại với `POSTGRES_*` trong `deploy/app.env`, rồi `docker compose up -d --force-recreate` |
| Đăng nhập báo sai mật khẩu ở lần đầu | `SEED_PASSWORD` đã đổi sau khi CSDL được nạp | Đặt lại mật khẩu bằng tài khoản `admin`, hoặc làm lại từ đầu bằng `docker compose down -v` |
| Upload file báo lỗi dung lượng | File vượt 25 MB | Giới hạn theo thiết kế; Admin đổi trong màn Cấu hình và sửa `client_max_body_size` ở `deploy/nginx.conf` |
| Tải lại trang thì mất file đính kèm | Chạy `down -v` làm mất volume `storage` | Khôi phục từ bản sao lưu ở mục 5 |
| Build lỗi ở bước `npm ci` | Máy chủ không ra được Internet | Mở mạng cho máy chủ, hoặc build image ở nơi khác rồi `docker save` / `docker load` |

Xem giao diện đang nói chuyện với đâu: badge góc phải màn hình hiện **PostgreSQL** (xanh) là đang ghi thật vào cơ sở dữ liệu.

---

## 8. Khác biệt so với chạy trên Windows

| | Windows (`start.bat`) | Docker trên Linux |
| :-- | :-- | :-- |
| Giao diện | Vite dev server, cổng 5173 | nginx phục vụ bản build tĩnh, cổng 80 |
| Gọi API | Proxy của Vite | Proxy của nginx |
| Backend | `ts-node src/main.ts` | `node dist/main.js` (đã biên dịch) |
| Cơ sở dữ liệu | PostgreSQL cài trên máy | Container `db` + volume `db-data` |
| Tệp đính kèm | `apps/api/storage/` | Volume `storage` |
| Migration | `npm run db:push` | `prisma migrate deploy` tự chạy lúc khởi động |
| Mất backend | Tự lùi về chế độ demo trên trình duyệt | **Báo lỗi và dừng** — tránh nhập liệu vào chỗ không được lưu |
