# MA TRẬN KIỂM THỬ — WORKFLOW v3.4

> **Nguồn chuẩn:** [`docs/workflow.md`](workflow.md) · Tổng quan: [doc.md](doc.md)
> **Cập nhật:** 2026-09-29

---

## 1. Phạm vi và cách chạy

| Tầng | Vị trí | Lệnh | Trạng thái |
| :-- | :-- | :-- | :-- |
| Luật nghiệp vụ (FSM, phân quyền, số tiền, file, scheduler, đăng nhập) | `src/domain/__tests__/workflow.test.ts` | `npm run test:domain` (thư mục gốc, Node ≥ 22.6) | ✅ 35/35 đạt (2026-09-29) |
| Giao diện + backend + PostgreSQL, end-to-end | Kịch bản Chrome DevTools Protocol, chưa đưa vào repo | — | ✅ 15/15 bước đạt, không lỗi runtime (2026-09-29) |
| Backend (unit/integration riêng) | — | — | ⚠️ Chưa có. Luật đã được phủ gián tiếp qua e2e và `src/domain` |

Bộ test nghiệp vụ chạy trên `src/domain` — bản đặc tả có thể chạy được. `apps/api/src/common/domain.ts` là bản song sinh phía máy chủ; khi sửa một bên phải sửa bên kia.

---

## 2. Ma trận transition

| # | Trường hợp | Kỳ vọng | Unit | E2E |
| :-- | :-- | :-- | :-: | :-: |
| T1 | Đủ field + 2 file B1 | DRAFT → LEADER_APPROVAL, báo mọi Lãnh đạo | ✅ | ✅ |
| T1 | Thiếu file / tổng tiền ≤ 0 / chưa tick | `ERR_DOC_INCOMPLETE` / `ERR_AMOUNT_NOT_POSITIVE` / `ERR_PAYMENT_NO_CONFIRM` | ✅ | — |
| T1 | Không còn Lãnh đạo hoạt động | `ERR_NO_LEADER`, phiếu giữ nguyên, Admin nhận thông báo | ✅ | — |
| T2 | Hủy ở B1, không nhập lý do | CANCELLED | ✅ | — |
| T2 | Hủy ở B3 hoặc B5 | `ERR_INVALID_TRANSITION` — từ B2 trở đi không ai hủy được | ✅ | — |
| T3 | Lãnh đạo duyệt | → ADVANCE_PREPARATION, báo NV cung ứng | ✅ | ✅ |
| T3 | Tự duyệt phiếu mình tạo | `ERR_SELF_APPROVAL` | ✅ | — |
| T3–T5 | Vai trò khác Lãnh đạo (TPTC, Kế toán) | `ERR_FORBIDDEN` | ✅ | — |
| T5 | Trả lại kèm lý do | → DRAFT, cờ "Gửi lại", mở khóa lại file B1 | ✅ | — |
| T4/T5 | Lý do rỗng | `ERR_REASON_REQUIRED` | ✅ | — |
| T6 | Tạm ứng 0 / > tổng / thiếu file | `ERR_ADV_ZERO` / `ERR_ADV_EXCEED_TOTAL` / `ERR_DOC_INCOMPLETE` | ✅ | — |
| T7 | TPTC duyệt | Tự gán kế toán duy nhất, ghi ưu tiên, comment `[TÀI CHÍNH ĐIỀU PHỐI]`, báo kế toán | ✅ | ✅ |
| T7 | Thiếu tick / thiếu ưu tiên / sai vai trò | `ERR_PAYMENT_NO_CONFIRM` / `ERR_REQUIRED_FIELD` / `ERR_FORBIDDEN` | ✅ | — |
| T7 | Không còn Kế toán hoạt động | `ERR_NO_ACCOUNTANT`, giữ B4, báo Admin | ✅ | — |
| T8 | Thiếu tick / thiếu UNC / kế toán khác | `ERR_PAYMENT_NO_CONFIRM` / `ERR_DOC_INCOMPLETE` / `ERR_FORBIDDEN` | ✅ | ✅ |
| T9 | Quyết toán < tạm ứng | `ERR_SETTLE_BELOW_ADV`; giao diện báo lỗi **ngay tại ô nhập** và khóa nút gửi | ✅ | ✅ |
| T9 | Quyết toán ≥ tạm ứng | → FINAL_PAYMENT, tính đúng Còn lại phải chi | ✅ | ✅ |
| T10 | Còn lại > 0 mà thiếu UNC đợt cuối | `ERR_FINAL_NO_PROOF` | ✅ | — |
| T10→T11 | Không HĐ, hoặc đã có hóa đơn từ B6 | COMPLETED trong cùng thao tác | ✅ | — |
| T10→T12 | Có HĐ, ô hóa đơn trống | → B8, bắt đầu đếm ngày làm việc | ✅ | ✅ |
| T13 | Upload hóa đơn | → COMPLETED, báo kế toán phụ trách | ✅ | ✅ |
| — | `AUTO_VERIFY` không bao giờ được lưu | Không phiếu nào mang trạng thái này | ✅ | ✅ |

## 3. Đặc quyền Admin

| Trường hợp | Kỳ vọng | Unit | E2E |
| :-- | :-- | :-: | :-: |
| A1 vượt bước chi tiền chưa có giao dịch | Vẫn chuyển, trả `warning` (không chặn) | ✅ | — |
| A1/A2/A3/xóa trên phiếu COMPLETED | Đều thực hiện được; A3 giữ nguyên mã phiếu và lịch sử | ✅ | — |
| A2 khi đã phát sinh giao dịch chi | Vẫn hủy, trả `warning` | ✅ | — |
| A3 mở lại thẳng vào bước được chọn | Về đúng bước Admin chọn | ✅ | — |
| A4 chuyển giao NV cung ứng | Đổi người phụ trách, **không** đổi trạng thái; chỉ Admin | ✅ | — |
| Admin sửa dữ liệu và thay file trên phiếu COMPLETED | Thực hiện được | ✅ | — |
| Vai trò nghiệp vụ đụng phiếu đã kết thúc | `ERR_INVALID_TRANSITION` / `ERR_FILE_LOCKED` | ✅ | — |

## 4. Ràng buộc chung

| Trường hợp | Kỳ vọng | Unit | E2E |
| :-- | :-- | :-: | :-: |
| Optimistic locking | `version` cũ → `ERR_VERSION_CONFLICT` | ✅ | — |
| Khóa file theo bước | File B1 khóa sau T1, mở lại sau T5; kế toán chỉ dùng ô chứng từ chi | ✅ | — |
| Cây thư mục lưu trữ | `/CHUNG_TU/{CUNG_UNG\|KE_TOAN}/{YYYY-MM-DD}/{MA_PHIEU}/{file}` | ✅ | ✅ |
| Trùng tên file trong cùng folder | Thêm hậu tố `_{HHmmss}` | ✅ | ✅ |
| Whitelist và giới hạn 25 MB | `ERR_FILE_TYPE`, `ERR_FILE_TOO_LARGE` | ✅ | — |
| Hàng đợi RLS | Mỗi vai trò chỉ thấy hàng đợi của mình | ✅ | — |
| Tra cứu hồ sơ | Mọi vai trò thấy mọi phiếu ở mọi trạng thái, kể cả DRAFT | ✅ | — |
| Route ngoài vai trò | "Không có quyền truy cập" ở frontend, `403` ở backend | — | ✅ |
| Scheduler B8 | Quá 5 ngày làm việc → cờ trễ hạn + nhắc 1 lần/ngày, không đổi trạng thái | ✅ | — |
| Nhật ký 6 ngày | Bản ghi cũ hơn bị dọn; dòng thời gian phiếu giữ nguyên | ✅ | — |
| Ngày làm việc | Bỏ T7, CN và ngày lễ | ✅ | — |

## 5. Xác thực và tài khoản

| Trường hợp | Kỳ vọng | Unit | E2E |
| :-- | :-- | :-: | :-: |
| Username không phân biệt hoa thường | Đăng nhập được | ✅ | ✅ |
| Sai mật khẩu | Báo số lần còn lại; lần thứ 5 → khóa tạm 15 phút | ✅ | — |
| Mật khẩu mới yếu | `ERR_WEAK_PASSWORD` | ✅ | — |
| Tài khoản thứ 2 trong cùng phòng ban | `ERR_DEPARTMENT_OCCUPIED` | ✅ | — |
| Khóa Admin cuối cùng | `ERR_LAST_ADMIN` | ✅ | — |
| Trùng username | `ERR_DUPLICATE_USERNAME` | ✅ | — |
| Xóa tài khoản còn gắn phiếu / tự xóa mình | `ERR_USER_IN_USE` / `ERR_CANNOT_DELETE_SELF` | ✅ | — |
| 4 phòng ban cố định | Đúng 4 phòng, phòng ban tự theo vai trò, Admin không thuộc phòng nào | ✅ | — |
| Danh mục đang dùng | `ERR_MASTER_DATA_IN_USE`; Lãnh đạo/TPTC/KT chỉ đọc | ✅ | — |

---

## 6. Kết quả chạy e2e gần nhất (2026-09-29)

Một phiếu đi trọn luồng trên PostgreSQL: `PYC-202609-0008`.

- Dòng thời gian ghi nhận: `CREATE → T1 → T3 → T6 → T7 → T8 → T9 → T10 → T12 → T13`.
- Giao dịch: `ADVANCE 40.000.000` và `FINAL 35.000.000`.
- 9 tệp đính kèm nằm đúng hai nhánh `CUNG_UNG/` và `KE_TOAN/`.
- Trạng thái cuối: `COMPLETED`.

---

## 7. Còn thiếu

- Chưa có bộ test tự động cho backend (`apps/api`); hiện dựa vào e2e chạy tay và `src/domain`.
- Kịch bản e2e chưa đưa vào repo (dự án chưa cài Playwright).
- Chưa kiểm tra xung đột thật giữa hai người dùng thao tác đồng thời trên giao diện (mới có unit test cho `version`).
