# HỆ THỐNG PHIẾU YÊU CẦU CHI

Ứng dụng quản lý phiếu yêu cầu chi theo quy trình **workflow v3.4**: phiếu đi qua 8 bước
(B1–B8) với 13 chuyển tiếp T1–T13, 4 phòng ban cố định và 1 tài khoản quản trị.

Đặc tả nghiệp vụ đầy đủ: [`docs/workflow.md`](docs/workflow.md).

---

## 1. Kiến trúc

| Thành phần | Công nghệ | Thư mục |
|---|---|---|
| Giao diện | Vite + React 18 + TypeScript + Tailwind | [`src/`](src/) |
| Lõi nghiệp vụ dùng chung | TypeScript thuần, 35 test `node --test` | [`src/domain/`](src/domain/) |
| API | NestJS 10 + Prisma 5 + argon2 + JWT | [`apps/api/`](apps/api/) |
| CSDL | PostgreSQL 18 | [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) |
| Đóng gói | Docker Compose (nginx + api + postgres) | [`docker-compose.yml`](docker-compose.yml) |

Máy trạng thái nằm trong `src/domain/` và được nhân bản ở `apps/api/src/common/domain.ts`
để máy chủ không bao giờ tin vào phán quyết của trình duyệt. Hai tệp này phải luôn khớp nhau.

## 2. Vai trò

| Vai trò | Phòng ban | Bước phụ trách |
|---|---|---|
| `REQUESTER` | Phòng Cung Ứng | B1 tạo phiếu, B6 nhận hàng, B8 bổ sung hóa đơn |
| `LEADER` | Lãnh Đạo | B2 phê duyệt |
| `FINANCE_MANAGER` | Phòng Tài Chính | B3 cân đối dòng tiền |
| `ACCOUNTANT` | Phòng Kế Toán | B4 chi tạm ứng, B5 chuyển tiền, B7 quyết toán |
| `ADMIN` | (không thuộc phòng ban) | A1–A4: sửa, chuyển, ép bước, hủy |

## 3. Chạy bằng Docker (khuyến nghị)

Một lệnh trên máy chủ Linux trắng — tự cài Docker, sinh mật khẩu, dựng và kiểm tra:

```bash
curl -fsSL https://raw.githubusercontent.com/luanitnipponham/quanlykho/main/deploy.sh -o deploy.sh
sudo bash deploy.sh
```

Hoặc làm thủ công nếu đã có Docker:

```bash
cp deploy/app.env.example deploy/app.env   # rồi đổi mật khẩu và JWT_SECRET
docker compose up -d --build
```

Mở `http://<địa-chỉ-máy-chủ>/`. Chỉ container `web` mở cổng ra ngoài;
API và PostgreSQL nằm trong mạng nội bộ của compose.

Cập nhật lên phiên bản mới về sau — cùng một script, chạy lại là xong:

```bash
cd /opt/quanlykho
git fetch origin main && git reset --hard origin/main
./deploy.sh
```

Muốn máy chủ khỏi phải build, kéo image dựng sẵn trên GHCR: `PREBUILT=true ./deploy.sh`

Hướng dẫn triển khai Linux chi tiết: [`docs/deploy.md`](docs/deploy.md).

## 4. Chạy trực tiếp khi phát triển

Windows: chạy [`start.bat`](start.bat) (lần đầu dùng `start.bat setup`).

Thủ công:

```bash
npm install && npm run dev                 # giao diện  → http://localhost:5173
cd apps/api && npm install && npm run dev  # API        → http://localhost:3000/api/v1
```

Cần một `.env` ở thư mục gốc và một ở `apps/api/` (xem `deploy/app.env.example` để biết các khóa).

## 5. Dữ liệu

```bash
cd apps/api
npm run db:seed          # 4 phòng ban + 5 tài khoản + ngày lễ
SEED_DEMO=true npm run db:seed   # thêm danh mục và phiếu mẫu để xem thử
npm run db:reset-data    # xóa sạch phiếu, danh mục và tệp đính kèm, giữ tài khoản
```

Mật khẩu mặc định của các tài khoản mẫu lấy từ `SEED_PASSWORD`, mặc định `Password@123`
— **đổi ngay sau lần đăng nhập đầu tiên trên môi trường thật.**

## 6. Kiểm thử

```bash
npm run test:domain   # 35 test máy trạng thái
npm run typecheck
npm run lint
```

## 7. Tài liệu

| Tệp | Nội dung |
|---|---|
| [`docs/workflow.md`](docs/workflow.md) | Đặc tả nghiệp vụ gốc (v3.4) |
| [`docs/doc.md`](docs/doc.md) | Tổng quan hệ thống |
| [`docs/api.md`](docs/api.md) | Danh sách endpoint |
| [`docs/erd.md`](docs/erd.md) | Sơ đồ quan hệ dữ liệu |
| [`docs/permissions.md`](docs/permissions.md) | Ma trận quyền |
| [`docs/test-matrix.md`](docs/test-matrix.md) | Ma trận kiểm thử |
| [`docs/security.md`](docs/security.md) | Mô hình bảo mật |
| [`docs/deploy.md`](docs/deploy.md) | Triển khai lên Linux |
