import './env';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const now = new Date();
  const us = await p.user.findMany({ orderBy: { createdAt: 'asc' } });
  for (const u of us) {
    const locked = u.lockedUntil && u.lockedUntil > now
      ? `KHOA TAM den ${u.lockedUntil.toLocaleTimeString('vi-VN')}` : '-';
    console.log(
      u.username.padEnd(10),
      String(u.role).padEnd(16),
      String(u.status).padEnd(8),
      'sai:' + u.failedLoginCount,
      'doiMK:' + (u.mustChangePassword ? 'co' : 'khong'),
      locked,
    );
  }
  const cfg = await p.systemConfig.findUnique({ where: { key: 'SYSTEM' } });
  console.log('cau hinh: toi da', cfg?.maxLoginAttempts, 'lan sai, khoa', cfg?.lockMinutes, 'phut');
  const fails = await p.auditLog.findMany({ where: { action: { in: ['LOGIN_FAILED', 'LOGIN_LOCKED'] } }, orderBy: { createdAt: 'desc' }, take: 6 });
  console.log('--- lan dang nhap hong gan nhat ---');
  for (const f of fails) console.log(f.createdAt.toLocaleTimeString('vi-VN'), f.action, '|', f.detail);
  await p.$disconnect();
})();
