// Dọn sạch dữ liệu nghiệp vụ để test lại từ đầu với dữ liệu thật.
// Chạy: npm run db:reset-data  (từ apps/api)
//
// XOÁ: phiếu, lịch sử, đính kèm (cả file trên ổ đĩa), giao dịch chi, bình luận,
//      thông báo, audit log, bộ đếm mã phiếu và toàn bộ danh mục mẫu.
// GIỮ: 4 phòng ban, tài khoản đăng nhập, ngày lễ, cấu hình hệ thống.
import './env';
import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { STORAGE_ROOT } from './common/domain';
import { STORAGE_DIR } from './files/files';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Thứ tự xoá theo chiều khoá ngoại: con trước, cha sau.
  const deleted = {
    commentMentions: (await prisma.commentMention.deleteMany()).count,
    comments: (await prisma.comment.deleteMany()).count,
    attachments: (await prisma.attachment.deleteMany()).count,
    transactions: (await prisma.paymentTransaction.deleteMany()).count,
    timeline: (await prisma.requestTimeline.deleteMany()).count,
    notifications: (await prisma.notification.deleteMany()).count,
    requests: (await prisma.paymentRequest.deleteMany()).count,
    // Bộ đếm phải về 0, nếu không mã phiếu thật sẽ nối tiếp số của phiếu mẫu.
    sequences: (await prisma.requestSequence.deleteMany()).count,
    auditLogs: (await prisma.auditLog.deleteMany()).count,
    projects: (await prisma.project.deleteMany()).count,
    categories: (await prisma.category.deleteMany()).count,
    requesterNames: (await prisma.requesterName.deleteMany()).count,
    vendors: (await prisma.vendor.deleteMany()).count,
    accountantNames: (await prisma.accountantName.deleteMany()).count,
  };

  // Ổ đĩa phải khớp database: xoá nội dung CHUNG_TU nhưng giữ lại cây thư mục gốc.
  const root = path.join(STORAGE_DIR, STORAGE_ROOT);
  let files = 0;
  for (const folder of ['CUNG_UNG', 'KE_TOAN']) {
    const dir = path.join(root, folder);
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    for (const entry of entries) {
      files += 1;
      await fs.rm(path.join(dir, entry), { recursive: true, force: true });
    }
    await fs.mkdir(dir, { recursive: true });
  }

  const kept = {
    departments: await prisma.department.count(),
    users: await prisma.user.count(),
    holidays: await prisma.holiday.count(),
  };
  console.log('[reset] đã xoá:', deleted);
  console.log(`[reset] đã xoá ${files} thư mục/tệp trong ${root}`);
  console.log('[reset] giữ lại:', kept);
}

main()
  .catch((e) => {
    console.error('[reset] lỗi:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
