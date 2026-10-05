# RÀ SOÁT AN NINH (v3.4)

> **Nguồn chuẩn:** [`docs/workflow.md`](workflow.md) · Tiêu chuẩn: [security.md](security.md)
> **Ngày rà:** 2026-09-29 · **Phạm vi:** `apps/api/src/` (backend v3.4) và `src/` (frontend v3.4)
> **Kết luận:** đạt cho môi trường nội bộ / phát triển. **Chưa đạt cho production** — xem mục 3.

---

## 1. Các điểm đã kiểm và đạt

| Tiêu chí | Cách triển khai | Kết quả |
| :-- | :-- | :-- |
| Băm mật khẩu | `argon2id` qua thư viện `argon2`; không lưu bản rõ, không trả `passwordHash` trong bất kỳ response nào | ✅ |
| Khóa tạm khi dò mật khẩu | Sai 5 lần → khóa 15 phút qua `lockedUntil`; có test | ✅ |
| Bắt buộc đổi mật khẩu lần đầu | `mustChangePassword` chặn ở giao diện; mật khẩu mới ≥ 8 ký tự, có chữ và số, khác mật khẩu cũ | ✅ |
| Access token ngắn hạn | JWT 15 phút, claims tối thiểu (`sub`, `role`) | ✅ |
| Refresh token | Chỉ lưu bản băm SHA-256; xoay vòng, thu hồi token cũ khi cấp token mới | ✅ |
| Khóa tài khoản vô hiệu phiên | `JwtStrategy.validate` đọc lại `status` mỗi request; khóa tài khoản thu hồi mọi refresh token | ✅ |
| Deny by default | `JwtAuthGuard` toàn cục; chỉ `/auth/login`, `/auth/refresh` là `@Public()` | ✅ |
| Phân quyền 2 tầng | `RolesGuard` theo vai trò + `authorize()` theo trạng thái và phạm vi dữ liệu | ✅ |
| Tách biệt nhiệm vụ ở B2 | `ERR_SELF_APPROVAL` khi người duyệt trùng người tạo | ✅ |
| Chống xử lý trùng | Mọi transition trong một transaction, kiểm tra và tăng `version` | ✅ |
| Toàn vẹn tiền | `NUMERIC(18,2)`; ràng buộc `0 < tạm ứng ≤ tổng`, `0 ≤ đã chi thêm ≤ tổng − tạm ứng` | ✅ |
| Sinh mã phiếu | `upsert ... increment` trên `request_sequences`, an toàn khi chạy song song | ✅ |
| Chống path traversal | Tên file chuẩn hóa về `[A-Za-z0-9_-]`, không còn `..` hay `/`; `storage_path` `UNIQUE` | ✅ |
| Giới hạn upload | Whitelist định dạng + 25 MB, kiểm tra ở cả hai tầng | ✅ |
| Tải file có kiểm soát | Qua `/attachments/:id/download` kèm token; không phục vụ thư mục tĩnh | ✅ |
| Nhật ký không sửa được | `audit_log` chỉ thêm; dòng thời gian phiếu lưu vĩnh viễn, tách khỏi hạn 6 ngày | ✅ |
| Không hardcode bí mật | Mọi cấu hình qua `.env`; `.env` đã nằm trong `.gitignore` | ✅ |
| Validation đầu vào | `ValidationPipe({ whitelist: true, transform: true })` toàn cục + DTO `class-validator` | ✅ |
| Chống SQL injection | Prisma dùng truy vấn tham số hóa; không có SQL ghép chuỗi từ đầu vào người dùng | ✅ |
| Không lộ chi tiết lỗi | `AllExceptionsFilter` trả mã lỗi nghiệp vụ; lỗi ngoài dự kiến ghi log máy chủ và trả thông báo chung | ✅ |

---

## 2. Điểm cần lưu ý (chấp nhận được ở môi trường hiện tại)

| Điểm | Hiện trạng | Rủi ro |
| :-- | :-- | :-- |
| `JWT_SECRET` có giá trị mặc định | `.env` đang dùng secret môi trường phát triển | Thấp khi chạy `localhost`; **phải đổi** trước khi mở ra mạng |
| Job dọn nhật ký dùng chung tài khoản ứng dụng | Tài khoản ứng dụng vẫn có quyền `DELETE` trên `audit_log` | Ứng dụng bị chiếm quyền có thể xóa dấu vết |
| Upload giữ toàn bộ file trong bộ nhớ | Giới hạn 25 MB/file, tối đa 20 file/lần | Chấp nhận được ở quy mô 4 phòng ban, 1 người/phòng |
| Snapshot trả toàn bộ phiếu | `/payment-requests/snapshot` phục vụ giao diện | Dữ liệu vốn là read-only với mọi vai trò (workflow §1.7); cần phân trang khi số phiếu lớn |

---

## 3. Bắt buộc làm trước khi chạy thật

1. **HTTPS/TLS + HSTS** — hiện chạy HTTP trên `localhost`.
2. **Security headers** qua Helmet (CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`).
3. **Rate limiting** cho `/auth/login` và các endpoint ghi.
4. **Đổi `JWT_SECRET`** sang chuỗi ngẫu nhiên đủ dài, quản lý bằng secret manager.
5. **Thu hồi quyền `UPDATE`/`DELETE`** trên `audit_log` với tài khoản ứng dụng; job dọn dẹp dùng DB role riêng.
6. **Sao lưu định kỳ** PostgreSQL và thư mục `storage/`, có kiểm tra khôi phục.
7. **Bộ test bảo mật tự động** cho backend — hiện chưa có (xem [test-matrix.md](test-matrix.md) mục 7).
8. **Quét virus** file upload nếu mở cho người dùng ngoài mạng nội bộ.

---

## 4. Ghi chú về phạm vi

Bản rà soát này đọc mã nguồn và chạy thử luồng nghiệp vụ; **không** bao gồm kiểm thử xâm nhập, phân tích phụ thuộc (`npm audit`) hay rà soát hạ tầng máy chủ. Những phần đó nên làm riêng trước khi đưa hệ thống ra ngoài mạng nội bộ.
