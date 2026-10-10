# HỆ THỐNG PHIẾU YÊU CẦU CHI — ĐẶC TẢ HỆ THỐNG (v3.4)

> **Nguồn chuẩn (Source of Truth):** [`docs/workflow.md`](workflow.md) v3.4. Khi tài liệu này và `workflow.md` mâu thuẫn, `workflow.md` thắng.
> **Tài liệu liên quan:** [permissions.md](permissions.md) · [api.md](api.md) · [domain-model.md](domain-model.md) · [erd.md](erd.md) · [security.md](security.md) · [test-matrix.md](test-matrix.md)
> **Cập nhật:** 2026-09-29

---

## 1. Mục tiêu

Số hóa quy trình **Phiếu yêu cầu chi** gồm 8 bước (B1 → B8) qua 4 phòng ban: Cung Ứng → Lãnh Đạo → Tài Chính → Kế Toán, cộng Admin quản trị. Mọi thay đổi trạng thái là một transition của máy trạng thái (FSM) ở mục 5; mọi thao tác đều qua kiểm tra **vai trò × phạm vi dữ liệu** (mục 8) và được ghi nhật ký.

---

## 2. Kiến trúc

| Tầng | Công nghệ | Vị trí |
| :-- | :-- | :-- |
| Frontend | Vite + React 18 + TypeScript + Tailwind + lucide-react | `src/` |
| Backend | NestJS 10 + Prisma 5 + argon2 + JWT | `apps/api/src/` |
| CSDL | PostgreSQL 18 | `apps/api/prisma/schema.prisma` |
| Lưu file | Ổ đĩa máy chủ, cây `CHUNG_TU/` (mục 9.3) | `apps/api/storage/` |
| Tác vụ nền | `@nestjs/schedule`, chạy 00:00 hằng ngày | `apps/api/src/app.module.ts` |

### 2.1. Hai chế độ chạy của frontend

| Chế độ | Khi nào | Dữ liệu |
| :-- | :-- | :-- |
| **PostgreSQL** | Backend ở `localhost:3000` trả lời | Nguồn thật. Mọi ghi đi qua REST, sau đó frontend nạp lại snapshot. |
| **Demo** | Không thấy backend | Chạy cùng bộ luật `src/domain/` ngay trên trình duyệt (localStorage + IndexedDB). |

Thanh trên cùng hiển thị chế độ đang chạy. `src/domain/` là bản đặc tả có test (`npm run test:domain`); `apps/api/src/common/domain.ts` là bản song sinh phía máy chủ — hai bên phải luôn khớp nhau.

### 2.2. Chạy hệ thống

```bash
# 1. Backend + CSDL (thư mục apps/api)
npm run db:push     # tạo schema trong PostgreSQL
npm run db:seed     # 4 phòng ban, 5 tài khoản, phiếu mẫu
npm start           # http://localhost:3000/api/v1

# 2. Frontend (thư mục gốc)
npm run dev         # http://localhost:5173  (proxy /api → :3000)
```

| Việc | Lệnh |
| :-- | :-- |
| Kiểm thử luật nghiệp vụ | `npm run test:domain` (thư mục gốc) |
| Kiểm tra kiểu / build | `npm run typecheck` · `npm run build` |
| Dựng lại CSDL từ đầu | `npm run db:reset && npm run db:seed` (apps/api) |

---

## 3. Nguyên tắc vận hành cốt lõi

1. **Đi đủ trình tự B1 → B8**, không bỏ bước. Mỗi ô ☑ là một chốt chuyển bước.
2. **Checkpoint bắt buộc:** chỉ chuyển bước khi người phụ trách tick đúng ô ☑ và hệ thống xác thực đủ field, file. Chưa tick thì bộ phận kế tiếp không thấy phiếu.
3. **TPTC duyệt B4** rồi phiếu tự chuyển cho tài khoản Kế toán duy nhất.
4. **Thanh toán không chờ hóa đơn:** B7 chi dứt điểm phần còn lại kể cả khi chưa có hóa đơn; phiếu "Có hóa đơn" mà thiếu hóa đơn tự vào B8.
5. **Cô lập trách nhiệm:** mỗi phiếu có đúng một `assignedRequesterId` và một `assignedAccountantId`.
6. **Trao đổi trên record:** thiếu sót ở bất kỳ bước nào → comment và @ người phụ trách. **Kế toán không có nút trả lại.**
7. **Mọi phòng ban xem được toàn bộ phiếu ở mọi trạng thái** (kể cả DRAFT) và tải được mọi file qua Tra cứu; nhưng chỉ xử lý phiếu trong hàng đợi của mình.
8. **Super Admin toàn quyền ở mọi trạng thái**, kể cả phiếu Hoàn thành. Mọi thao tác đặc quyền bắt buộc nhập lý do và ghi nhật ký.

---

## 4. Vai trò và phòng ban

Mỗi tài khoản có **đúng 1 vai trò**; phòng ban tự theo vai trò. Mỗi phòng ban chỉ có **đúng 1 tài khoản đang hoạt động**.

| Mã vai trò | Vai trò | Phòng ban | Phạm vi |
| :-- | :-- | :-- | :-- |
| `REQUESTER` | Nhân viên cung ứng | Phòng Cung Ứng | Tạo và nộp hồ sơ B1, B3, B6, B8 |
| `LEADER` | Lãnh đạo | Lãnh Đạo | Duyệt / từ chối / trả lại B2 |
| `FINANCE_MANAGER` | Trưởng phòng Tài chính | Phòng Tài Chính | Duyệt B4 và chuyển Kế toán |
| `ACCOUNTANT` | Nhân viên kế toán | Phòng Kế Toán | Chi tạm ứng B5, thanh toán B7 |
| `ADMIN` | Quản trị hệ thống | — (không thuộc phòng nào) | A1–A4, người dùng, danh mục, cấu hình |

Bốn phòng ban cố định, Admin chỉ đổi được tên/mã, không thêm hay xóa.

---

## 5. Máy trạng thái

### 5.1. Trạng thái

| Bước | Mã | Tên hiển thị | Người xử lý |
| :-- | :-- | :-- | :-- |
| B1 | `DRAFT` | Tạo phiếu mới | NV cung ứng |
| B2 | `LEADER_APPROVAL` | Chờ Lãnh đạo duyệt | Lãnh đạo |
| B3 | `ADVANCE_PREPARATION` | Nộp hồ sơ tạm ứng | NV cung ứng |
| B4 | `COORDINATION` | Chờ TPTC duyệt | TPTC |
| B5 | `ADVANCE_PAYMENT` | PKT tạm ứng | Kế toán |
| B6 | `AFTER_ADVANCE` | Theo dõi sau tạm ứng | NV cung ứng |
| B7 | `FINAL_PAYMENT` | PKT thanh toán | Kế toán |
| — | `AUTO_VERIFY` | Kiểm tra tự động (**không lưu**) | Hệ thống |
| B8 | `DOCUMENT_SUPPLEMENT_REQUIRED` | Cần bổ sung hóa đơn | NV cung ứng |
| Kết thúc | `COMPLETED` / `CANCELLED` / `REJECTED` | Hoàn thành / Đã hủy / Bị từ chối | Chỉ xem (Admin toàn quyền) |

### 5.2. Transition nghiệp vụ (T1–T13)

| # | Từ | Hành động | Người thực hiện | Điều kiện bắt buộc | Đến |
|--|--|--|--|--|--|
| T1 | B1 | ☑ Gửi Lãnh đạo | NV CU | Đủ field; Tổng tiền > 0; 2 file (Phiếu yêu cầu, Báo giá & bảng so sánh giá); còn ≥ 1 Lãnh đạo hoạt động | B2 |
| T2 | B1 | Hủy đơn | NV CU | **Không cần lý do**; xóa hẳn phiếu + tệp đính kèm | (phiếu biến mất) |
| T3 | B2 | ☑ Lãnh đạo duyệt | Lãnh đạo | Không tự duyệt phiếu mình tạo | B3 |
| T4 | B2 | Từ chối | Lãnh đạo | Bắt buộc lý do | REJECTED |
| T5 | B2 | Trả lại | Lãnh đạo | Bắt buộc nội dung cần bổ sung | B1 |
| T6 | B3 | ☑ Hoàn tất HS tạm ứng | NV CU | 0 < Tạm ứng ≤ Tổng đề nghị; file Đơn đặt hàng, Đề nghị tạm ứng | B4 |
| T7 | B4 | ☑ TPTC duyệt và chuyển Kế toán | TPTC | Độ ưu tiên; còn ≥ 1 Kế toán hoạt động (hệ thống tự gán) | B5 |
| T8 | B5 | ☑ Đã KT HS + ☑ Đã thanh toán tạm ứng | Kế toán được giao | UNC/Phiếu chi; ngày chi | B6 |
| T9 | B6 | ☑ Hoàn tất HS ĐN thanh toán | NV CU | 0 ≤ Đã chi thêm ≤ Tổng đề nghị − Đã tạm ứng; file BNH, ĐNTT | B7 |
| T10 | B7 | ☑ Đã KT HS hoàn ứng + ☑ HOÀN THÀNH | Kế toán | UNC đợt cuối nếu Còn lại > 0; ngày chi | AUTO_VERIFY |
| T11 | AUTO_VERIFY | AUTO_PASS | Hệ thống | Không HĐ **hoặc** đã có hóa đơn | COMPLETED |
| T12 | AUTO_VERIFY | AUTO_REQUIRE_INVOICE | Hệ thống | Có HĐ **và** ô hóa đơn trống | B8 |
| T13 | B8 | Upload hóa đơn | NV CU | File hóa đơn hợp lệ | COMPLETED |

> T10 → T11/T12 chạy trong **một** transaction. Admin thực hiện thay được mọi transition ở đúng bước của nó.

### 5.3. Đặc quyền Admin (A1–A4)

| # | Hành động | Áp dụng | Điều kiện | Kết quả |
|--|--|--|--|--|
| A1 | Ép chuyển bước | Mọi trạng thái, kể cả COMPLETED | Lý do; **cảnh báo** (không chặn) khi vượt bước chi tiền chưa có giao dịch | Trạng thái được chọn |
| A2 | Admin hủy phiếu | Mọi trạng thái | Lý do; **cảnh báo** nếu đã phát sinh giao dịch chi | CANCELLED |
| A3 | Mở lại phiếu | CANCELLED, REJECTED, COMPLETED | Lý do; giữ mã phiếu và lịch sử | B1 hoặc bước Admin chọn |
| A4 | Chuyển giao NV cung ứng | Mọi trạng thái | Người nhận là NV CU đang hoạt động | Đổi `assignedRequesterId`, giữ trạng thái |

Ngoài ra Admin sửa dữ liệu, thay file, tick thay và xóa phiếu ở **mọi trạng thái**.

---

## 6. Ràng buộc nghiệp vụ và mã lỗi

| Mã | Loại | Khi nào |
| :-- | :-- | :-- |
| `ERR_REQUIRED_FIELD` | Chặn | Thiếu field bắt buộc |
| `ERR_AMOUNT_NOT_POSITIVE` | Chặn | Tổng đề nghị ≤ 0 |
| `ERR_DOC_INCOMPLETE` | Chặn | Thiếu file ở ô bắt buộc của bước |
| `ERR_ADV_ZERO` / `ERR_ADV_EXCEED_TOTAL` | Chặn | Tạm ứng ≤ 0 hoặc > Tổng đề nghị |
| `ERR_SETTLE_OVER_BUDGET` | Chặn | Đã chi thêm > Tổng đề nghị − Đã tạm ứng. Giao diện báo lỗi **ngay tại ô nhập** và khóa nút gửi |
| `ERR_PAYMENT_NO_CONFIRM` | Chặn | Chưa tick đủ ô ☑ |
| `ERR_FINAL_NO_PROOF` | Chặn | Còn lại > 0 mà thiếu UNC đợt cuối ở B7 |
| `ERR_SELF_APPROVAL` | Chặn | Duyệt B2 phiếu do chính mình tạo |
| `ERR_NO_LEADER` / `ERR_NO_ACCOUNTANT` | Chặn | Không còn tài khoản Lãnh đạo / Kế toán hoạt động; báo Admin |
| `ERR_REASON_REQUIRED` | Chặn | Thiếu lý do ở T4, T5, A1–A4 |
| `ERR_INVALID_TRANSITION` | Chặn | Hành động không hợp lệ với trạng thái hiện tại |
| `ERR_VERSION_CONFLICT` | Chặn | `version` đã đổi (người khác vừa xử lý) |
| `ERR_FILE_TYPE` / `ERR_FILE_TOO_LARGE` / `ERR_FILE_LOCKED` | Chặn | Sai định dạng / vượt 25 MB / ô đã khóa theo bước |
| `ERR_DEPARTMENT_OCCUPIED` | Chặn | Phòng ban đã có tài khoản đang hoạt động |
| `ERR_LAST_ADMIN` / `ERR_CANNOT_DELETE_SELF` / `ERR_USER_IN_USE` | Chặn | Khóa Admin cuối / tự xóa mình / xóa tài khoản còn gắn phiếu |
| `ERR_MASTER_DATA_IN_USE` | Chặn | Xóa danh mục đang gắn phiếu chưa kết thúc |

Quy tắc thêm:
1. Mã phiếu `PYC-YYYYMM-NNNN`, tự sinh dưới khóa dòng của bộ đếm tháng, không sửa.
2. Còn lại phải chi = **Tổng đề nghị − Đã chi thêm − Đã tạm ứng** (hệ thống tự tính). Ô "Đã chi thêm" ở B6 nhận 0
   khi không chi thêm đồng nào ngoài khoản tạm ứng, và không được vượt *Tổng đề nghị − Đã tạm ứng* — vượt là
   Còn lại phải chi âm, nên chặn ngay tại ô nhập lẫn trong engine (`ERR_SETTLE_OVER_BUDGET`).
3. **Khóa hồ sơ theo bước:** file và field chỉ sửa khi phiếu ở đúng bước và chưa tick. Riêng ô Hóa đơn mở ở B6, B7, B8.
4. **Không áp dụng SoD** ngoài B2: hệ thống chỉ chặn việc tự duyệt phiếu mình tạo (T3).
5. **Hủy phiếu chỉ có ở B1, và là xóa hẳn** — không để lại bản ghi "Đã hủy". Từ B2 trở đi không phòng ban nào hủy được; chỉ Lãnh đạo có Từ chối / Trả lại. A2 của Admin ngoài ràng buộc này và vẫn cho ra trạng thái `CANCELLED`.
6. B2 không định tuyến theo phòng ban: mọi Lãnh đạo đang hoạt động đều duyệt được.
7. B8: scheduler chạy hằng ngày; quá 5 ngày làm việc (bỏ T7, CN, ngày lễ do Admin quản lý) → gắn cờ trễ hạn, nhắc NV CU và kế toán phụ trách. Cờ trễ hạn **không đổi trạng thái**.
8. Độ ưu tiên chọn ở B4 dùng sắp xếp hàng đợi B5, B7.
9. Mọi transition kiểm tra `status` **và** `version` trong cùng transaction.

---

## 7. Hàng đợi (Row-Level Security)

| View | Điều kiện lọc |
| :-- | :-- |
| Tổng hợp (B1, B3) | `assignedRequesterId = me AND status IN (DRAFT, ADVANCE_PREPARATION)` |
| Lãnh đạo duyệt (B2) | `status = LEADER_APPROVAL` (mọi Lãnh đạo) |
| Chờ TPTC duyệt (B4) | `status = COORDINATION` (role TPTC) |
| Đang xử lý (TPTC) | `status IN (B5, B6, B7, B8)` — chỉ theo dõi |
| PKT tạm ứng (B5) | `assignedAccountantId = me AND status = ADVANCE_PAYMENT` |
| Theo dõi sau tạm ứng (B6) | `assignedRequesterId = me AND status = AFTER_ADVANCE` |
| PKT thanh toán (B7) | `assignedAccountantId = me AND status = FINAL_PAYMENT` |
| Bổ sung hóa đơn (B8) | `assignedRequesterId = me AND status = DOCUMENT_SUPPLEMENT_REQUIRED` |
| Theo dõi thiếu HĐ (KT) | `assignedAccountantId = me AND status = DOCUMENT_SUPPLEMENT_REQUIRED` |
| Phiếu hoàn thành | `status = COMPLETED` (chỉ xem, mọi người dùng) |
| Tra cứu hồ sơ | Mọi phiếu, mọi trạng thái (chỉ xem, tải mọi file) |

Admin thấy toàn bộ ở mọi hàng đợi.

---

## 8. Phân quyền

Quyền = **vai trò** × **phạm vi dữ liệu**, kiểm tra ở cả giao diện (ẩn nút) và backend (`authorize()` trong `apps/api/src/common/domain.ts`). Ma trận đầy đủ: [permissions.md](permissions.md).

---

## 9. Master data, tệp đính kèm, nhật ký

### 9.1. Master data trên form B1
Dự án, Hạng mục chi, Người yêu cầu, Nhà cung cấp. NV cung ứng và Admin được Thêm · Sửa · Xóa mềm; các vai trò khác chỉ đọc. Phòng ban: 4 phòng cố định, chỉ Admin đổi tên. Loại chi là checkbox **"Có hóa đơn"**, không phải danh mục.

### 9.2. Ô đính kèm

| Bước | Mã ô | Ô đính kèm | Bắt buộc |
| :-- | :-- | :-- | :-- |
| B1 | `REQUEST_FORM`, `QUOTATION_COMPARISON` | Phiếu yêu cầu · Báo giá & bảng so sánh giá | Đủ 2 |
| B3 | `PURCHASE_ORDER`, `ADVANCE_REQUEST` | Đơn đặt hàng · Đề nghị tạm ứng | Đủ 2 |
| B5 | `ADVANCE_PROOF` | UNC / Phiếu chi | Có |
| B6 | `DELIVERY_RECORD`, `PAYMENT_REQUEST_DOC`, `INVOICE` | BNH · ĐNTT · Hóa đơn | BNH, ĐNTT; Hóa đơn nếu có |
| B7 | `FINAL_PROOF` | UNC / Phiếu chi đợt cuối | Có, nếu Còn lại > 0 |
| B8 | `INVOICE` | Hóa đơn | Có |

Mỗi file tối đa **25 MB**. Người không phụ trách chỉ Xem và Tải về, không xóa, không sửa. Kế toán chỉ upload chứng từ chi của mình.

### 9.3. Lưu trữ file

```
CHUNG_TU/
├── CUNG_UNG/            ← file ở B1, B3, B6, B8
│   └── 2026-09-29/      ← ngày upload thực tế
│       └── PYC-202609-0008/
│           ├── PYC.pdf
│           └── BaoGia.pdf
└── KE_TOAN/             ← file ở B5, B7
    └── 2026-09-29/
        └── PYC-202609-0008/
            └── UNC.pdf
```

- Đường dẫn: `/CHUNG_TU/{CUNG_UNG|KE_TOAN}/{YYYY-MM-DD}/{MA_PHIEU}/{file_name}`.
- **Không** phân loại theo định dạng: tài liệu và hình ảnh nằm chung trong folder mã phiếu.
- Tên file chuẩn hóa (bỏ dấu, ký tự đặc biệt → `_`); trùng tên trong cùng folder thì thêm hậu tố `_{HHmmss}`.
- Gốc trên máy chủ: `apps/api/storage/` (đổi bằng biến môi trường `STORAGE_DIR`).

### 9.4. Nhật ký
Mọi thao tác ghi vào nhật ký. Mỗi người xem tab **Lịch sử** của mình; Admin xem toàn hệ thống. Nhật ký giữ **6 ngày** rồi tự xóa, không ai sửa được. Dữ liệu của phiếu (dòng thời gian, lý do, comment, file) **không** bị xóa theo 6 ngày.

---

## 10. Giao diện theo vai trò

Không có màn "Trang chủ" — mỗi vai trò vào thẳng mục menu đầu tiên của mình.

| Vai trò | Menu |
| :-- | :-- |
| NV cung ứng | Tạo phiếu B1 · Phiếu của tôi · Hồ sơ tạm ứng B3 · Theo dõi sau tạm ứng B6 · Bổ sung hóa đơn B8 · Tra cứu hồ sơ · Lịch sử |
| Lãnh đạo | Chờ tôi duyệt B2 · Tra cứu hồ sơ · Báo cáo · Lịch sử |
| TPTC | Chờ TPTC duyệt B4 · Đang xử lý · Báo cáo · Tra cứu hồ sơ · Lịch sử |
| NV kế toán | PKT tạm ứng B5 · PKT thanh toán B7 · Theo dõi thiếu HĐ · Tra cứu hồ sơ · Lịch sử |
| Admin | Quản lý phiếu · Người dùng · Danh mục · Cấu hình · Nhật ký · Báo cáo |
| Dùng chung | Đăng nhập · Tra cứu hồ sơ · Chi tiết phiếu · Phiếu hoàn thành |

### 10.1. Bản đồ route

| Route | Màn hình | Vai trò |
| :-- | :-- | :-- |
| `/procurement/requests/new` | Tạo phiếu B1 | REQUESTER |
| `/procurement/my-requests` · `/procurement/overview` | Phiếu của tôi · Hồ sơ tạm ứng B3 | REQUESTER |
| `/procurement/after-advance` · `/procurement/supplement-invoice` | B6 · B8 | REQUESTER |
| `/approvals/leader` | Chờ tôi duyệt B2 | LEADER |
| `/finance/coordination` · `/finance/monitor` | Chờ TPTC duyệt B4 · Đang xử lý | FINANCE_MANAGER |
| `/accounting/advance-payments` · `/accounting/final-payments` · `/accounting/missing-invoices` | B5 · B7 · Thiếu HĐ | ACCOUNTANT |
| `/admin/requests` · `/admin/users` · `/admin/master-data` · `/admin/config` | Quản trị | ADMIN |
| `/lookup` · `/history` · `/reports` · `/reports/completed-requests` · `/requests/:id` · `/change-password` | Dùng chung | Theo mục 10 |

Gõ thẳng URL ngoài vai trò → màn "Không có quyền truy cập" ở frontend và `403` ở backend.

---

## 11. Xác thực

- Đăng nhập bằng **username do Admin cấp** + mật khẩu (không dùng email). Username duy nhất, không phân biệt hoa thường.
- Mật khẩu băm bằng **argon2**; bắt buộc đổi ở lần đăng nhập đầu (`mustChangePassword`).
- Sai quá `maxLoginAttempts` (mặc định 5) → khóa tạm `lockMinutes` (15). Mọi lần đăng nhập ghi nhật ký.
- **JWT access token** ngắn hạn (15 phút) + **refresh token** 7 ngày có xoay vòng. Admin khóa tài khoản → thu hồi toàn bộ refresh token, phiên đang mở mất hiệu lực ngay.

---

## 12. Thông báo tự động

| Sự kiện | Người nhận |
| :-- | :-- |
| T1 Gửi Lãnh đạo | Mọi Lãnh đạo |
| T3 Lãnh đạo duyệt | NV cung ứng |
| T4 / T5 Từ chối / Trả lại | NV cung ứng |
| T6 Hoàn tất HS tạm ứng | TPTC |
| T7 TPTC duyệt | Kế toán được giao |
| T8 Đã chi tạm ứng | NV cung ứng |
| T9 Hoàn tất HS ĐNTT | Kế toán phụ trách |
| T11 / T12 Hoàn thành / Cần bổ sung HĐ | NV cung ứng |
| T13 Đã upload hóa đơn | Kế toán phụ trách |
| A1 / A2 / A3 / A4 | NV cung ứng và kế toán phụ trách |
| B8 quá hạn (hằng ngày) | NV cung ứng, kế toán phụ trách |
| Không còn Lãnh đạo / Kế toán hoạt động | Admin |
| Comment có `@username` | Người được nhắc |

---

## 13. Tác vụ nền

Chạy lúc 00:00 hằng ngày và một lần khi backend khởi động:
1. Xóa bản ghi nhật ký cũ hơn `auditRetentionDays` (6 ngày).
2. Với mỗi phiếu B8: quá `invoiceDeadlineWorkingDays` ngày làm việc → gắn `lateInvoice` và gửi nhắc (tối đa 1 lần/ngày/phiếu).

---

## 14. Các điểm chưa chốt (TBD)

- Hạn mức duyệt theo số tiền (hiện cố định 1 cấp Lãnh đạo ở B2).
- Nhiều lần tạm ứng cho một phiếu (hiện 1 lần ở B5).
- Tích hợp ERP/MISA và xác thực hóa đơn điện tử (hiện chỉ kiểm tra có file).
- Thời hạn lưu trữ chứng từ pháp lý và cơ chế archive.
- Quy trình thu hồi khi chi thực tế nhỏ hơn khoản đã tạm ứng (hiện chỉ tính Còn lại phải chi, không có luồng hoàn tiền về công ty).
