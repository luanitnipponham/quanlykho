# DOMAIN MODEL — HỆ THỐNG PHIẾU YÊU CẦU CHI (v3.4)

> **Nguồn chuẩn:** [`docs/workflow.md`](workflow.md) · Tổng quan: [doc.md](doc.md) · Lược đồ: [erd.md](erd.md)
> **Cài đặt:** `src/domain/` (frontend, có test) và `apps/api/src/common/domain.ts` (backend). Hai bản phải luôn khớp nhau.

---

## 1. Bounded contexts

1. **Identity & Access** — 5 vai trò cố định, 4 phòng ban, phiên đăng nhập, khóa tài khoản.
2. **Master Data** — Dự án, Hạng mục chi, Người yêu cầu, Nhà cung cấp (xóa mềm).
3. **Payment Request (aggregate chính)** — phiếu, số tiền, giao dịch chi, tệp đính kèm theo ô, comment.
4. **Workflow** — FSM T1–T13 và đặc quyền A1–A4; dòng thời gian lưu vĩnh viễn.
5. **Scheduling** — ngày nghỉ lễ, đếm ngày làm việc của B8, dọn nhật ký.
6. **Collaboration** — comment, `@nhắc tên`, thông báo.
7. **Audit** — nhật ký thao tác, giữ 6 ngày, không ai sửa được.

---

## 2. Aggregate `PaymentRequest`

| Thuộc tính | Ý nghĩa |
| :-- | :-- |
| `code` | `PYC-YYYYMM-NNNN`, cấp một lần dưới khóa dòng của bộ đếm tháng, bất biến |
| `status` | Một trong 11 trạng thái lưu được (không có `AUTO_VERIFY`) |
| `version` | Khóa lạc quan; mọi transition kiểm tra và tăng trong cùng transaction |
| `createdById`, `createdByRole` | Dùng cho luật không tự duyệt ở B2 |
| `assignedRequesterId` | NV cung ứng phụ trách (mặc định = người tạo; đổi qua A4) |
| `assignedAccountantId` | Kế toán phụ trách; hệ thống tự gán ở T7 |
| `projectId`, `categoryId`, `requesterNameId`, `vendorId`, `title`, `note` | Thông tin B1 |
| `hasInvoice` | Checkbox "Có hóa đơn" — quyết định nhánh AUTO_VERIFY |
| `requestedAmount` | Tổng đề nghị (> 0) |
| `advanceAmount` | Tạm ứng (B3): 0 < x ≤ `requestedAmount` |
| `settlementAmount` | Đã chi thêm (B6): 0 ≤ giá trị ≤ `requestedAmount` − `advanceAmount`. Giữ tên cột cũ `settlement_amount` |
| `priority` | `HIGH`, `MEDIUM`, `LOW` — chọn ở B4, dùng xếp hàng đợi B5/B7 |
| `invoiceDueStartAt`, `lateInvoice`, `lastLateReminderOn` | Đếm và gắn cờ hạn B8 |
| `resubmitted` | Bị Lãnh đạo trả lại (T5) hoặc Admin mở lại (A3) |

**Con của aggregate:** `Attachment` (theo `slot`, `stage`, `folder`), `PaymentTransaction` (`ADVANCE`, `FINAL`), `Comment` (có `mentions`), `TimelineEntry`.

### 2.1. Bất biến

1. Mọi transition: `status` khớp cột "Từ" **và** `version` khớp, trong một transaction.
2. `requestedAmount > 0`; `0 < advanceAmount ≤ requestedAmount`; `settlementAmount ≥ advanceAmount` mới qua được T9.
3. Người duyệt B2 ≠ người tạo phiếu (`ERR_SELF_APPROVAL`). Ngoài B2 không áp dụng tách biệt nhiệm vụ.
4. T10 luôn kết thúc ở `COMPLETED` hoặc `DOCUMENT_SUPPLEMENT_REQUIRED`; `AUTO_VERIFY` không bao giờ được ghi xuống CSDL.
5. Hủy phiếu chỉ ở B1 (T2, không cần lý do) và xóa hẳn phiếu khỏi database. Từ B2 trở đi chỉ Lãnh đạo có Từ chối / Trả lại; `CANCELLED` chỉ còn do A2 của Admin.
6. Cờ `lateInvoice` không đổi trạng thái phiếu.
7. **Admin đứng ngoài mọi ràng buộc trạng thái**: A1–A4, sửa dữ liệu, thay file, tick thay và xóa phiếu chạy được ở mọi trạng thái, kể cả COMPLETED. Hệ thống chỉ trả `warning`.

### 2.2. Dòng thời gian

`TimelineEntry` ghi `CREATE`, `T1`–`T13`, `A1`–`A4` kèm `fromStatus`, `toStatus`, `actorId`, `reason`. Đây là dữ liệu của phiếu, **không** bị dọn theo hạn nhật ký 6 ngày. Hai dòng `T10` → `T11`/`T12` nằm cùng một transaction.

---

## 3. Identity

| Entity | Thuộc tính chính |
| :-- | :-- |
| `User` | `username` (duy nhất, không phân biệt hoa thường), `fullName`, `passwordHash` (argon2), `mustChangePassword`, `role` (1 giá trị), `departmentId` (tự theo vai trò, `null` với ADMIN), `status`, `failedLoginCount`, `lockedUntil` |
| `Department` | Cố định 4 dòng theo `kind`: `PROCUREMENT` Phòng Cung Ứng · `BOARD` Lãnh Đạo · `FINANCE` Phòng Tài Chính · `ACCOUNTING` Phòng Kế Toán |

Bất biến: mỗi vai trò nghiệp vụ chỉ 1 tài khoản `ACTIVE`; luôn còn ≥ 1 ADMIN `ACTIVE`; tài khoản còn gắn phiếu thì chỉ khóa được, không xóa.

---

## 4. Tệp đính kèm

`Slot` gồm 9 ô (xem [doc.md §9.2](doc.md)). Mỗi ô có `stages` (các bước mở ô), `owner` (`REQUESTER` hoặc `ACCOUNTANT`) và `folder` (`CUNG_UNG` hoặc `KE_TOAN`).

Quy tắc: chỉ đính/xóa khi phiếu ở đúng bước và chưa tick; ô `INVOICE` mở ở B6, B7, B8; kế toán chỉ dùng ô chứng từ chi của mình; các vai trò khác chỉ Xem và Tải về. Đường dẫn `/CHUNG_TU/{folder}/{YYYY-MM-DD}/{code}/{fileName}`, tối đa 25 MB.

---

## 5. Scheduling

- `Holiday { date, name }` — Admin quản lý; dùng đếm ngày làm việc (bỏ T7, CN, ngày lễ).
- `SystemConfig` — `invoiceDeadlineWorkingDays` (5), `maxLoginAttempts` (5), `lockMinutes` (15), `maxFileSizeMb` (25), `auditRetentionDays` (6), `allowedExtensions`.

Không còn lịch vắng mặt: kế toán vắng thì Admin dùng A1 hoặc tick thay.

---

## 6. Domain events

| Event | Phát ra khi |
| :-- | :-- |
| `RequestCreated` | Tạo DRAFT |
| `SubmittedToLeader` | T1 |
| `RequestCancelled` | T2 (B1) hoặc A2 (Admin) |
| `LeaderApproved` / `LeaderRejected` / `LeaderReturned` | T3 / T4 / T5 |
| `AdvanceDocsCompleted` | T6 |
| `DispatchedToAccountant` | T7 |
| `AdvancePaid` | T8 |
| `SettlementSubmitted` | T9 |
| `FinalPaid` → `AutoPassed` \| `InvoiceRequired` | T10 → T11 / T12 |
| `InvoiceSupplied` | T13 |
| `ForcedTransition` / `Reopened` / `RequesterTransferred` | A1 / A3 / A4 |
| `InvoiceOverdue` | Scheduler phát hiện phiếu B8 quá hạn |
| `NoLeaderAvailable` / `NoAccountantAvailable` | T1 / T7 bị chặn — báo Admin |
| `CommentMentioned` | Comment có `@username` |
