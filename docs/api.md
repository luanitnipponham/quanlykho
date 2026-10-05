# API CONTRACT — HỆ THỐNG PHIẾU YÊU CẦU CHI (v3.4)

> **Base URL:** `/api/v1` (backend NestJS ở `localhost:3000`; frontend gọi qua proxy Vite `/api`)
> **Nguồn chuẩn:** [`docs/workflow.md`](workflow.md) · Tổng quan: [doc.md](doc.md) · Phân quyền: [permissions.md](permissions.md)
> **Cài đặt:** `apps/api/src/`

---

## 1. Chuẩn phản hồi

### 1.1. Thành công
```json
{ "success": true, "data": { }, "meta": { "timestamp": "2026-09-29T04:12:00.000Z" } }
```

### 1.2. Lỗi
```json
{
  "success": false,
  "error": { "code": "ERR_SETTLE_BELOW_ADV", "message": "Giá trị quyết toán không được nhỏ hơn số đã tạm ứng (40.000.000 ₫)" },
  "meta": { "timestamp": "2026-09-29T04:12:00.000Z" }
}
```

| HTTP | Mã lỗi |
| :-- | :-- |
| 400 | `ERR_REQUIRED_FIELD`, `ERR_AMOUNT_NOT_POSITIVE`, `ERR_DOC_INCOMPLETE`, `ERR_ADV_ZERO`, `ERR_ADV_EXCEED_TOTAL`, `ERR_SETTLE_BELOW_ADV`, `ERR_PAYMENT_NO_CONFIRM`, `ERR_FINAL_NO_PROOF`, `ERR_REASON_REQUIRED`, `ERR_INVALID_TRANSITION`, `ERR_NO_LEADER`, `ERR_NO_ACCOUNTANT`, `ERR_FILE_TYPE`, `ERR_FILE_TOO_LARGE`, `ERR_FILE_LOCKED`, `ERR_VERSION_CONFLICT`, `ERR_DEPARTMENT_OCCUPIED`, `ERR_LAST_ADMIN`, `ERR_USER_IN_USE`, `ERR_MASTER_DATA_IN_USE`, `ERR_WEAK_PASSWORD`, `ERR_DUPLICATE_USERNAME` |
| 401 | `ERR_UNAUTHENTICATED`, `ERR_INVALID_CREDENTIALS`, `ERR_TOKEN_EXPIRED` |
| 403 | `ERR_FORBIDDEN`, `ERR_SELF_APPROVAL`, `ERR_CANNOT_DELETE_SELF` |
| 423 | `ERR_ACCOUNT_LOCKED`, `ERR_ACCOUNT_TEMP_LOCKED` |

Mọi route đều cần `Authorization: Bearer <accessToken>` trừ `/auth/login` và `/auth/refresh`.

---

## 2. Xác thực

| Method | Endpoint | Mô tả | Body |
|---|---|---|---|
| `POST` | `/auth/login` | Đăng nhập bằng **username**. Sai quá 5 lần → khóa tạm 15 phút | `{ username, password }` |
| `POST` | `/auth/refresh` | Cấp access token mới, xoay vòng refresh token | `{ refreshToken }` |
| `GET` | `/auth/me` | Người dùng hiện tại | — |
| `POST` | `/auth/logout` | Thu hồi toàn bộ refresh token của tài khoản | — |
| `POST` | `/auth/change-password` | Đổi mật khẩu (bắt buộc ở lần đăng nhập đầu) | `{ oldPassword, newPassword }` |

`login` trả `{ accessToken, refreshToken, mustChangePassword, user }`. `user` không bao giờ chứa `passwordHash`.

---

## 3. Phiếu yêu cầu chi

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/payment-requests?queue=<queue>` | Hàng đợi theo RLS. `queue` ∈ `overview`, `myRequests`, `leaderApproval`, `coordination`, `financeMonitor`, `advancePayments`, `afterAdvance`, `finalPayments`, `supplementInvoice`, `missingInvoices`, `completed`, `all` |
| `GET` | `/payment-requests/snapshot` | Toàn bộ phiếu kèm file, giao dịch, dòng thời gian, comment — dùng để nạp một lần cho giao diện |
| `GET` | `/payment-requests/:id` | Chi tiết một phiếu |
| `POST` | `/payment-requests` | Tạo phiếu DRAFT, tự sinh mã `PYC-YYYYMM-NNNN` |
| `PATCH` | `/payment-requests/:id` | Sửa thông tin B1 (Admin sửa được ở mọi trạng thái). Body kèm `version` |
| `DELETE` | `/payment-requests/:id` | Xóa phiếu — Admin, mọi trạng thái. Body `{ reason, version }` |

Body tạo phiếu:
```json
{ "title": "Thép hộp mạ kẽm", "projectId": "…", "categoryId": "…", "requesterNameId": "…",
  "vendorId": "…", "requestedAmount": 90000000, "hasInvoice": true, "note": "",
  "assignedRequesterId": "… (chỉ khi Admin tạo thay)" }
```

---

## 4. Transition (mọi body đều có `version`)

| Method | Endpoint | # | Từ → Đến | Body thêm |
|---|---|---|---|---|
| `POST` | `/payment-requests/:id/submit` | T1 | DRAFT → LEADER_APPROVAL | `{ confirmed: true }` |
| `POST` | `/payment-requests/:id/cancel` | T2 | DRAFT → CANCELLED | — (không cần lý do) |
| `POST` | `/payment-requests/:id/leader-approve` | T3 | LEADER_APPROVAL → ADVANCE_PREPARATION | `{ confirmed: true, note? }` |
| `POST` | `/payment-requests/:id/leader-reject` | T4 | LEADER_APPROVAL → REJECTED | `{ reason }` |
| `POST` | `/payment-requests/:id/leader-return` | T5 | LEADER_APPROVAL → DRAFT | `{ reason }` |
| `POST` | `/payment-requests/:id/submit-advance` | T6 | ADVANCE_PREPARATION → COORDINATION | `{ confirmed: true, advanceAmount }` |
| `POST` | `/payment-requests/:id/finance-approve` | T7 | COORDINATION → ADVANCE_PAYMENT | `{ confirmed: true, priority, accountantNameId, note? }` |
| `POST` | `/payment-requests/:id/pay-advance` | T8 | ADVANCE_PAYMENT → AFTER_ADVANCE | `{ checkedDocs: true, paid: true, method, paidDate }` |
| `POST` | `/payment-requests/:id/submit-settlement` | T9 | AFTER_ADVANCE → FINAL_PAYMENT | `{ confirmed: true, settlementAmount }` |
| `POST` | `/payment-requests/:id/pay-final` | T10→T11/T12 | FINAL_PAYMENT → COMPLETED \| DOCUMENT_SUPPLEMENT_REQUIRED | `{ checkedDocs: true, completed: true, method?, paidDate }` |
| `POST` | `/payment-requests/:id/complete-invoice` | T13 | DOCUMENT_SUPPLEMENT_REQUIRED → COMPLETED | — |

`pay-final` trả thêm `status` để client biết nhánh AUTO_VERIFY đã đi đâu.

## 5. Đặc quyền Admin

| Method | Endpoint | # | Body |
|---|---|---|---|
| `POST` | `/payment-requests/:id/force` | A1 | `{ toStatus, reason, version }` — trả `warning` nếu vượt bước chi tiền chưa có giao dịch |
| `POST` | `/payment-requests/:id/admin-cancel` | A2 | `{ reason, version }` — trả `warning` nếu đã có giao dịch chi |
| `POST` | `/payment-requests/:id/reopen` | A3 | `{ reason, version, toStatus? }` (mặc định DRAFT) |
| `POST` | `/payment-requests/transfer` | A4 | `{ items: [{ id, version }], toRequesterId, reason }` |

A1–A4 chạy được ở **mọi trạng thái**, kể cả COMPLETED. Hệ thống cảnh báo chứ không chặn.

---

## 6. Tệp đính kèm

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/payment-requests/:id/attachments` | Danh sách file của phiếu |
| `POST` | `/payment-requests/:id/attachments/:slot` | `multipart/form-data`, field `files` (tối đa 20 file/lần, mỗi file ≤ 25 MB) |
| `GET` | `/attachments/:id/download` | Tải/xem file |
| `DELETE` | `/attachments/:id` | Xóa (chỉ khi ô còn mở; Admin xóa mọi lúc) |

`slot` ∈ `REQUEST_FORM`, `QUOTATION_COMPARISON`, `PURCHASE_ORDER`, `ADVANCE_REQUEST`, `ADVANCE_PROOF`, `DELIVERY_RECORD`, `PAYMENT_REQUEST_DOC`, `INVOICE`, `FINAL_PROOF`.

File ghi xuống `/CHUNG_TU/{CUNG_UNG|KE_TOAN}/{YYYY-MM-DD}/{MA_PHIEU}/{file_name}` dưới `STORAGE_DIR` (mặc định `apps/api/storage`).

---

## 7. Comment và thông báo

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/payment-requests/:id/comments` | `{ content }`; `@username` trong nội dung sinh thông báo |
| `GET` | `/notifications` | Thông báo của tôi |
| `POST` | `/notifications/read` | `{ ids: string[] \| "ALL" }` |

---

## 8. Danh mục, phòng ban, người dùng, cấu hình

| Method | Endpoint | Quyền |
|---|---|---|
| `GET` | `/master-data/:kind` | Tất cả. `kind` ∈ `projects`, `categories`, `requesterNames`, `vendors`, `accountantNames` |
| `POST` / `PATCH` / `DELETE` | `/master-data/:kind[/:id]` | NV cung ứng, Admin. Riêng `accountantNames`: TPTC, Admin. DELETE là xóa mềm |
| `GET` | `/departments` | Tất cả — 4 phòng cố định kèm người thuộc phòng |
| `PATCH` | `/departments/:id` | Admin — chỉ đổi `code`, `name` |
| `GET` | `/users` | Tất cả (không trả mật khẩu) |
| `POST` / `PATCH` / `DELETE` | `/users[/:id]` | Admin |
| `POST` | `/users/:id/status` | Admin — `{ status: "ACTIVE" \| "LOCKED" }`; khóa sẽ thu hồi refresh token |
| `POST` | `/users/:id/reset-password` | Admin — `{ password }`, bật `mustChangePassword` |
| `GET` / `PATCH` | `/config` | Đọc: tất cả · Ghi: Admin |
| `GET` / `POST` / `DELETE` | `/holidays[/:date]` | Đọc: tất cả · Ghi: Admin |
| `GET` | `/history` | Nhật ký: của mình, Admin xem toàn hệ thống |
| `GET` | `/reports/summary` | Lãnh đạo, TPTC, Admin |

`config`: `invoiceDeadlineWorkingDays` (5), `maxLoginAttempts` (5), `lockMinutes` (15), `maxFileSizeMb` (25), `auditRetentionDays` (6), `allowedExtensions`.
