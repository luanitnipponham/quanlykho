-- Lưu trữ (A5): đánh dấu phiếu đã dọn file đính kèm khỏi đĩa máy chủ.
-- Hàng phiếu và hàng attachments giữ nguyên nên vẫn tra cứu và phục hồi được từ NAS.
ALTER TABLE "payment_requests" ADD COLUMN "archived_at" TIMESTAMP(3);
