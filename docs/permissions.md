# PHÂN QUYỀN — VAI TRÒ × PHẠM VI DỮ LIỆU (v3.4)

> **Nguồn chuẩn:** [`docs/workflow.md`](workflow.md) mục 7, 9.1, 11 · Tổng quan: [doc.md](doc.md)
> **Cài đặt:** `src/domain/permissions.ts` (frontend) và `apps/api/src/common/domain.ts` (backend) — hai bên cùng một bộ luật.

---

## 1. Nguyên tắc

1. **Mỗi tài khoản đúng 1 vai trò**; phòng ban tự theo vai trò. Mỗi phòng ban chỉ có **đúng 1 tài khoản đang hoạt động**. Admin không thuộc phòng ban nào.
2. **Quyền = Vai trò × Phạm vi.** Vai trò quyết định *hành động*; phạm vi quyết định *phiếu nào*.
3. **Kiểm tra 2 tầng:** giao diện ẩn nút và menu; backend từ chối request (`403`) kể cả khi gọi API trực tiếp. Mặc định từ chối.
4. **Admin là Super Admin:** toàn quyền ở mọi trạng thái, kể cả phiếu Hoàn thành. Hệ thống chỉ **cảnh báo**, không chặn.

### 1.1. Phạm vi dữ liệu

| Phạm vi | Điều kiện |
| :-- | :-- |
| Cá nhân (Cung ứng) | `assignedRequesterId = me` |
| Cá nhân (Kế toán) | `assignedAccountantId = me` |
| Lãnh đạo | Mọi phiếu ở B2 — không định tuyến theo phòng ban |
| TPTC | Mọi phiếu ở B4, và B5–B8 ở chế độ theo dõi |
| Toàn hệ thống | Admin |
| Chỉ đọc | Mọi người dùng xem và tải được **mọi phiếu ở mọi trạng thái** qua Tra cứu hồ sơ |

---

## 2. Ma trận theo phòng ban

**X** = làm được (trong phạm vi) · **Xem** = chỉ xem/tải · **–** = không có quyền.

| Hành động | NV cung ứng | Lãnh đạo | TPTC | NV kế toán | Admin |
| :-- | :-: | :-: | :-: | :-: | :-: |
| Tạo phiếu B1 (T1) | X | – | – | – | X |
| Hủy đơn B1 (T2, không cần lý do) | X | – | – | – | X |
| Duyệt / Từ chối / Trả lại B2 (T3–T5) | – | X | – | – | X |
| Nộp hồ sơ tạm ứng B3 (T6) | X | – | – | – | X |
| Duyệt và chuyển Kế toán B4 (T7) | – | – | X | – | X |
| Chi tạm ứng B5 (T8) | – | – | – | X | X |
| Nộp hồ sơ ĐN thanh toán B6 (T9) | X | – | – | – | X |
| Thanh toán B7 (T10) | – | – | – | X | X |
| Bổ sung hóa đơn B8 (T13) | X | – | – | – | X |
| Chuyển giao NV cung ứng (A4) | – | – | – | – | X |
| Ép chuyển / Hủy / Mở lại / Xóa phiếu (A1–A3) | – | – | – | – | X |
| Xem & tải hồ sơ mọi bước (Tra cứu) | Xem | Xem | Xem | Xem | Xem |
| Giám sát | – | Xem (mọi phiếu B2) | X (phiếu phía Kế toán) | – | X |
| Quản lý danh mục | Thêm/Sửa/Xóa¹ | – | – | – | X |
| Người dùng / Cấu hình / Nhật ký toàn hệ thống | – | – | – | – | X |
| Báo cáo | – | X | X | – | X |
| Comment và @nhắc tên | X | X | X | X | X |

> ¹ Không gồm danh mục Phòng ban (chỉ Admin đổi tên 4 phòng cố định). Xóa là xóa mềm.
> Phiếu đã Hoàn thành: các vai trò nghiệp vụ chỉ Xem; Admin toàn quyền (sửa, tick thay, ép chuyển, hủy, mở lại, xóa) kèm lý do và nhật ký.

---

## 3. Luật kiểm tra theo bản ghi

Mỗi transition đi qua đủ các bước sau **trong cùng transaction**:

1. Phiếu tồn tại.
2. `status` hiện tại nằm trong danh sách `ACTION_FROM[action]` → nếu không: `ERR_INVALID_TRANSITION`.
   Riêng Admin được bỏ qua bước này với `EDIT_DRAFT`, `TRANSFER`, `FORCE`, `ADMIN_CANCEL`, `DELETE`, `COMMENT`.

### Xóa phiếu (A3) là xóa vĩnh viễn

`DELETE /payment-requests/:id` xóa **thật** khỏi PostgreSQL, không phải đánh dấu ẩn. Khóa
ngoại khai báo `onDelete: Cascade` nên cuốn theo toàn bộ đính kèm, lịch sử luân chuyển,
giao dịch chi, bình luận và thông báo của phiếu. Sau đó máy chủ xóa nốt file vật lý trong
`CHUNG_TU` và dọn thư mục mã phiếu cùng thư mục ngày nếu đã rỗng.

File chỉ bị xóa **sau khi** transaction cam kết thành công. Làm ngược lại thì một lần
rollback sẽ để lại phiếu còn nguyên trong CSDL nhưng chứng từ đã mất vĩnh viễn.

Không khôi phục được. Chỉ còn lại dòng ghi trong nhật ký (kèm lý do và số file đã xóa),
và nhật ký cũng chỉ giữ 6 ngày. Muốn lấy lại phải khôi phục từ bản sao lưu —
xem [deploy.md §5](deploy.md).
3. Vai trò có quyền với hành động → nếu không: `ERR_FORBIDDEN`. Admin đi thẳng qua.
4. Phạm vi dữ liệu:
   - B1, B3, B6, B8: `assignedRequesterId = me`.
   - B2: vai trò `LEADER`; `createdById ≠ me` (`ERR_SELF_APPROVAL`).
   - B4: vai trò `FINANCE_MANAGER`.
   - B5, B7: `assignedAccountantId = me`.
5. `version` client gửi = `version` trong CSDL → nếu không: `ERR_VERSION_CONFLICT`.
6. Dữ liệu và file bắt buộc của bước (xem [doc.md §6, §9.2](doc.md)).
7. Ghi transition vào `request_timeline`, tăng `version`, ghi nhật ký và gửi thông báo.

### 3.1. B4 — TPTC duyệt và chuyển Kế toán

- Hệ thống **tự điền** tài khoản Kế toán duy nhất đang hoạt động; TPTC không chọn người.
- Không còn Kế toán nào hoạt động → `ERR_NO_ACCOUNTANT`, phiếu giữ nguyên B4, Admin nhận thông báo.
- Không có nhánh phân công nhiều người, không có điều hướng sang kế toán khác, không có cơ chế TPTC tự xử lý thay. Kế toán vắng mặt: Admin dùng A1 hoặc tick thay.

### 3.2. Tệp đính kèm

| Ai | Được làm |
| :-- | :-- |
| Người phụ trách bước hiện tại, chưa tick | Tải lên, Xem, Tải về, Xóa — chỉ ở ô của bước hiện tại |
| Kế toán | Chỉ ô chứng từ chi của mình (B5 `ADVANCE_PROOF`, B7 `FINAL_PROOF`) |
| Ô Hóa đơn | Mở ở B6, B7, B8 cho NV cung ứng phụ trách |
| Admin | Mọi ô ở mọi trạng thái, kể cả phiếu Hoàn thành |
| Người khác | Xem, Tải về — không xóa, không sửa |

### 3.3. Danh mục

- Thêm/Sửa/Xóa mềm Dự án, Hạng mục, Người yêu cầu, NCC: NV cung ứng và Admin.
- Phòng ban: 4 phòng cố định, chỉ Admin đổi tên/mã; không thêm, không xóa, không đổi loại.
- Không xóa được mục đang gắn với phiếu chưa kết thúc (`ERR_MASTER_DATA_IN_USE`).

### 3.4. Tài khoản

| Ràng buộc | Mã lỗi |
| :-- | :-- |
| Mỗi phòng ban chỉ 1 tài khoản đang hoạt động | `ERR_DEPARTMENT_OCCUPIED` |
| Luôn còn ≥ 1 Admin đang hoạt động | `ERR_LAST_ADMIN` |
| Không tự xóa tài khoản đang đăng nhập | `ERR_CANNOT_DELETE_SELF` |
| Tài khoản còn gắn phiếu thì chỉ khóa, không xóa | `ERR_USER_IN_USE` |
| Username duy nhất, không phân biệt hoa thường | `ERR_DUPLICATE_USERNAME` |

Khóa tài khoản sẽ thu hồi toàn bộ refresh token của người đó ngay lập tức.

---

## 4. Menu theo vai trò

Menu dựng từ `role` sau đăng nhập (bảng ở [doc.md §10](doc.md)). Không có màn "Trang chủ": mỗi vai trò vào thẳng mục menu đầu tiên. Route ngoài menu của vai trò → "Không có quyền truy cập" ở frontend và `403` ở backend.
