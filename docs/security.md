# AN NINH HỆ THỐNG (v3.4)

> **Nguồn chuẩn:** [`docs/workflow.md`](workflow.md) mục 11 · Tổng quan: [doc.md](doc.md) · Phân quyền: [permissions.md](permissions.md)
> **Cài đặt:** `apps/api/src/auth/auth.ts`, `apps/api/src/common/common.ts`, `apps/api/src/common/domain.ts`
> **Cập nhật:** 2026-09-29

---

## 1. Nguyên tắc

1. **Backend là nơi quyết định quyền.** Giao diện ẩn nút chỉ để đỡ rối mắt; mọi request đều bị kiểm tra lại ở máy chủ, kể cả khi gọi API trực tiếp.
2. **Mặc định từ chối.** Guard `JwtAuthGuard` áp toàn cục; chỉ `/auth/login` và `/auth/refresh` được đánh dấu `@Public()`.
3. **Ít quyền nhất có thể.** Mỗi tài khoản đúng 1 vai trò, mỗi vai trò chỉ chạm được hàng đợi của mình.
4. **Truy vết không chối bỏ được.** Mọi transition ghi vào `request_timeline` (vĩnh viễn) và `audit_log` (6 ngày).

---

## 2. Xác thực

### 2.1. Đăng nhập
- Đăng nhập bằng **username do Admin cấp**, **không** dùng email. So sánh không phân biệt hoa thường.
- Mật khẩu băm bằng **argon2id** (`argon2.hash`), không bao giờ lưu bản rõ và không bao giờ trả về trong response.
- Bắt buộc đổi mật khẩu ở lần đăng nhập đầu và sau khi Admin reset (`mustChangePassword`). Mật khẩu mới tối thiểu 8 ký tự, có cả chữ và số, và phải khác mật khẩu cũ.
- Sai quá `maxLoginAttempts` (mặc định 5) → khóa tạm `lockMinutes` (15 phút) qua cột `lockedUntil`. Bộ đếm reset khi đăng nhập thành công.
- Mọi lần đăng nhập thành công và thất bại đều ghi `audit_log` (`LOGIN`, `LOGIN_FAILED`, `LOGIN_LOCKED`).

### 2.2. Phiên đăng nhập
- **Access token**: JWT ký `HS256`, hạn 15 phút, claims tối thiểu `sub` và `role`.
- **Refresh token**: chuỗi ngẫu nhiên 48 byte, **chỉ lưu bản băm SHA-256** trong bảng `refresh_tokens`, hạn 7 ngày.
- **Xoay vòng (rotation)**: mỗi lần refresh, token cũ bị `revokedAt` ngay khi token mới được cấp.
- `JwtStrategy.validate` đọc lại tài khoản từ CSDL ở mọi request. Admin khóa tài khoản → request kế tiếp trả `401` dù access token còn hạn, và toàn bộ refresh token của người đó bị thu hồi.
- Đăng xuất thu hồi mọi refresh token của tài khoản.

> **Cần làm trước khi lên production:** `JWT_SECRET` hiện đọc từ `.env` và có giá trị mặc định dành cho môi trường phát triển. Phải đặt secret thật, dài và ngẫu nhiên; `.env` không được commit.

---

## 3. Phân quyền

- `RolesGuard` đọc decorator `@Roles(...)` trên từng route; Admin đi qua mọi cổng vai trò.
- `authorize(actor, request, action)` trong `common/domain.ts` kiểm tra thêm **trạng thái phiếu** và **phạm vi dữ liệu** (người phụ trách, kế toán được giao). Đây là cùng một bộ luật với `src/domain/permissions.ts` ở frontend.
- Riêng B2 áp dụng tách biệt nhiệm vụ: người duyệt không được là người tạo phiếu (`ERR_SELF_APPROVAL`).
- Admin (Super Admin) không bị chặn bởi trạng thái phiếu; hệ thống trả `warning` thay vì từ chối. Mọi thao tác đặc quyền bắt buộc nhập lý do và ghi nhật ký.

---

## 4. Toàn vẹn dữ liệu và chống xử lý trùng

- Mọi transition chạy trong **một** `prisma.$transaction`: đọc phiếu → kiểm tra quyền → so `version` → ghi thay đổi → tăng `version`.
- `version` lệch → `ERR_VERSION_CONFLICT`. Hai người bấm cùng lúc thì chỉ một giao dịch thành công, giao dịch còn lại rollback sạch.
- `T10 → T11/T12` nằm trong cùng transaction: không phiếu nào dừng lại ở `AUTO_VERIFY`.
- Tiền lưu `NUMERIC(18,2)`, không dùng kiểu dấu phẩy động.
- Mã phiếu cấp qua `request_sequences` với `upsert ... increment` nên không sinh trùng khi có nhiều request song song.
- Thông báo "báo Admin" (khi hết Lãnh đạo hoặc hết Kế toán) được ghi **ngoài** transaction, nên vẫn tới nơi dù hành động bị từ chối.

---

## 5. Tệp đính kèm

- Upload qua `multipart/form-data`, giữ trong bộ nhớ rồi ghi thẳng xuống đĩa; không chạy, không giải nén.
- **Whitelist định dạng** do Admin cấu hình; **giới hạn 25 MB** mỗi file, kiểm tra ở cả giao diện và máy chủ.
- Tên file chuẩn hóa (bỏ dấu, ký tự đặc biệt → `_`), nên không chứa `..` hay dấu `/` — chặn path traversal. Trùng tên thì thêm hậu tố `_{HHmmss}`.
- Đường dẫn ghi vào cột `storage_path` là `UNIQUE`; file nằm dưới `STORAGE_DIR`, mặc định `apps/api/storage`.
- Tải file đi qua `/attachments/:id/download`, vẫn phải có token hợp lệ; không phục vụ thư mục tĩnh ra ngoài.
- Quyền xóa file bám theo quyền của ô và bước hiện tại; Admin xóa được mọi lúc.

---

## 6. Nhật ký

- `audit_log` chỉ thêm, không sửa. Job hằng ngày xóa bản ghi cũ hơn `auditRetentionDays` (6 ngày).
- Dữ liệu của phiếu — dòng thời gian, lý do từ chối/trả lại, comment, file — nằm ở bảng riêng và **không** bị dọn.
- Nội dung ghi: `actorId`, `action`, `entity`, `entityId`, `detail`, `createdAt`. Không ghi mật khẩu, token hay bí mật nào.

> **Cần làm trước khi lên production:** thu hồi quyền `UPDATE`/`DELETE` trên `audit_log` với tài khoản ứng dụng, để job dọn dẹp chạy bằng một DB role riêng.

---

## 7. Cấu hình và môi trường

| Biến | Dùng cho |
| :-- | :-- |
| `DATABASE_URL` | Kết nối PostgreSQL |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Ký và hạn access token |
| `PORT` | Cổng backend (mặc định 3000) |
| `CORS_ORIGIN` | Danh sách origin được phép (mặc định `http://localhost:5173`) |
| `STORAGE_DIR` | Thư mục gốc chứa cây `CHUNG_TU/` |

`.env` nằm trong `.gitignore`. Không có bí mật nào hardcode trong mã nguồn.

---

## 8. Việc còn lại trước khi chạy thật

Hệ thống hiện chạy ở môi trường phát triển (`localhost`). Trước khi đưa vào dùng thật cần bổ sung:

1. **HTTPS/TLS** và HSTS; hiện chạy HTTP trên máy cục bộ.
2. **Security headers** (Helmet: CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`).
3. **Rate limiting** cho `/auth/login` và các endpoint ghi (`@nestjs/throttler`).
4. **JWT_SECRET thật**, khác giá trị mặc định trong `.env`.
5. **Sao lưu định kỳ** PostgreSQL và thư mục `storage/`.
6. **Quét virus** file upload nếu người dùng ngoài mạng nội bộ được tải lên.
7. **Bộ test bảo mật tự động** cho backend (hiện chưa có — xem [test-matrix.md](test-matrix.md) mục 7).
