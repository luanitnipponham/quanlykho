-- Danh mục tên nhân viên Phòng Kế toán. Phòng chỉ có một tài khoản đăng nhập nhưng
-- nhiều người làm, nên TPTC chỉ định ai nhận phiếu ở B4 (workflow §6.4).
CREATE TABLE "accountant_names" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accountant_names_pkey" PRIMARY KEY ("id")
);

-- Để trống với phiếu chưa qua B4, nên phiếu cũ không cần nạp lại.
ALTER TABLE "payment_requests" ADD COLUMN "accountant_name_id" TEXT;

ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_accountant_name_id_fkey"
    FOREIGN KEY ("accountant_name_id") REFERENCES "accountant_names"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
