// Seed for workflow v3.4: the four fixed departments, one account each, master data and demo requests.
// Run: npm run db:seed (from apps/api)
import './env';
import { PrismaClient, type PrismaClient as Client } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD || 'Password@123';
// Danh mục mẫu và phiếu mẫu chỉ nạp khi được yêu cầu rõ ràng (SEED_DEMO=true).
// Mặc định chỉ tạo phòng ban, tài khoản, ngày lễ và cấu hình — để test bằng dữ liệu thật.
const WITH_DEMO = process.env.SEED_DEMO === 'true';

const DEPARTMENTS = [
  { code: 'CU', name: 'Phòng Cung Ứng', kind: 'PROCUREMENT' as const },
  { code: 'LD', name: 'Lãnh Đạo', kind: 'BOARD' as const },
  { code: 'TC', name: 'Phòng Tài Chính', kind: 'FINANCE' as const },
  { code: 'KT', name: 'Phòng Kế Toán', kind: 'ACCOUNTING' as const },
];

const ACCOUNTS = [
  { username: 'cungung', fullName: 'Nguyễn Văn An', role: 'REQUESTER' as const, kind: 'PROCUREMENT' as const },
  { username: 'lanhdao', fullName: 'Phạm Quốc Hùng', role: 'LEADER' as const, kind: 'BOARD' as const },
  { username: 'taichinh', fullName: 'Lê Thị Hằng', role: 'FINANCE_MANAGER' as const, kind: 'FINANCE' as const },
  { username: 'ketoan', fullName: 'Đỗ Thị Thu', role: 'ACCOUNTANT' as const, kind: 'ACCOUNTING' as const },
  { username: 'admin', fullName: 'Quản trị hệ thống', role: 'ADMIN' as const, kind: null },
];

const PROJECTS = [
  ['DA-01', 'Chung cư Hoàng Mai – Block A'],
  ['DA-02', 'Nhà xưởng KCN Quế Võ'],
  ['DA-03', 'Cải tạo văn phòng trụ sở'],
];
const CATEGORIES = [
  ['VT', 'Vật tư chính'],
  ['CM', 'Thuê ca máy'],
  ['NC', 'Nhân công thầu phụ'],
  ['CPC', 'Chi phí chung công trường'],
];
const REQUESTER_NAMES = [
  ['CHT-01', 'Chỉ huy trưởng – Trần Đức Long'],
  ['KS-02', 'Kỹ sư giám sát – Ngô Thanh Tâm'],
  ['HC-01', 'Hành chính – Lý Thu Trang'],
];
const ACCOUNTANT_NAMES = [
  ['KT-01', 'Kế toán viên – Đỗ Thị Thu'],
  ['KT-02', 'Kế toán viên – Vũ Minh Khoa'],
];
const VENDORS = [
  ['NCC-001', 'Công ty TNHH Thép Việt Á'],
  ['NCC-002', 'Công ty CP Bê tông Hà Nội'],
  ['NCC-003', 'Công ty TNHH Máy xây dựng Phú Cường'],
  ['NCC-004', 'Hộ kinh doanh Văn phòng phẩm Minh Châu'],
];

async function main(): Promise<void> {
  const year = new Date().getFullYear();

  await prisma.systemConfig.upsert({
    where: { key: 'SYSTEM' },
    create: {
      key: 'SYSTEM',
      allowedExtensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'heic'],
    },
    update: {},
  });

  for (const d of DEPARTMENTS) {
    await prisma.department.upsert({ where: { kind: d.kind }, create: d, update: { code: d.code, name: d.name } });
  }

  const passwordHash = await argon2.hash(PASSWORD);
  for (const a of ACCOUNTS) {
    const department = a.kind ? await prisma.department.findUnique({ where: { kind: a.kind } }) : null;
    await prisma.user.upsert({
      where: { username: a.username },
      create: {
        username: a.username,
        fullName: a.fullName,
        role: a.role,
        departmentId: department?.id ?? null,
        passwordHash,
        // Demo accounts start ready to use; Admin-created ones must change on first login.
        mustChangePassword: false,
      },
      update: { fullName: a.fullName, role: a.role, departmentId: department?.id ?? null },
    });
  }

  if (WITH_DEMO) {
    await seedMaster(prisma, 'project', PROJECTS);
    await seedMaster(prisma, 'category', CATEGORIES);
    await seedMaster(prisma, 'requesterName', REQUESTER_NAMES);
    await seedMaster(prisma, 'vendor', VENDORS);
    await seedMaster(prisma, 'accountantName', ACCOUNTANT_NAMES);
  }

  for (const [date, name] of [
    [`${year}-01-01`, 'Tết Dương lịch'],
    [`${year}-04-30`, 'Ngày Giải phóng miền Nam'],
    [`${year}-05-01`, 'Quốc tế Lao động'],
    [`${year}-09-01`, 'Nghỉ Quốc khánh'],
    [`${year}-09-02`, 'Quốc khánh'],
  ]) {
    await prisma.holiday.upsert({ where: { date }, create: { date, name }, update: { name } });
  }

  if (WITH_DEMO) await seedRequests();

  const counts = {
    users: await prisma.user.count(),
    departments: await prisma.department.count(),
    requests: await prisma.paymentRequest.count(),
  };
  console.log('[seed] xong:', counts, `— mật khẩu chung: ${PASSWORD}`);
  if (!WITH_DEMO) console.log('[seed] bỏ qua danh mục và phiếu mẫu (đặt SEED_DEMO=true nếu muốn dữ liệu demo)');
}

async function seedMaster(db: Client, model: 'project' | 'category' | 'requesterName' | 'vendor' | 'accountantName', rows: string[][]) {
  for (const [code, name] of rows) {
    const existing = await (db[model] as never as { findFirst: (a: unknown) => Promise<{ id: string } | null> }).findFirst({ where: { name } });
    if (!existing) await (db[model] as never as { create: (a: unknown) => Promise<unknown> }).create({ data: { code, name } });
  }
}

/** A few requests spread across the workflow so every screen has something to show. */
async function seedRequests(): Promise<void> {
  if ((await prisma.paymentRequest.count()) > 0) {
    console.log('[seed] đã có phiếu, bỏ qua phần phiếu mẫu');
    return;
  }
  const [requester, leader, accountant] = await Promise.all([
    prisma.user.findUnique({ where: { username: 'cungung' } }),
    prisma.user.findUnique({ where: { username: 'lanhdao' } }),
    prisma.user.findUnique({ where: { username: 'ketoan' } }),
  ]);
  const [project, category, requesterName, vendor] = await Promise.all([
    prisma.project.findFirst(),
    prisma.category.findFirst(),
    prisma.requesterName.findFirst(),
    prisma.vendor.findFirst(),
  ]);

  const base = {
    createdById: requester.id,
    createdByRole: 'REQUESTER' as const,
    assignedRequesterId: requester.id,
    projectId: project.id,
    categoryId: category.id,
    requesterNameId: requesterName.id,
    vendorId: vendor.id,
  };

  const samples: { title: string; amount: number; status: 'DRAFT' | 'LEADER_APPROVAL' | 'ADVANCE_PREPARATION' | 'COORDINATION' | 'ADVANCE_PAYMENT'; advance?: number }[] = [
    { title: 'Mua văn phòng phẩm quý IV', amount: 8_500_000, status: 'DRAFT' },
    { title: 'Thép cuộn D10 cho sàn tầng 5', amount: 245_000_000, status: 'LEADER_APPROVAL' },
    { title: 'Thiết bị đo đạc cho phòng Kỹ thuật', amount: 56_000_000, status: 'ADVANCE_PREPARATION' },
    { title: 'Nhân công lắp dựng cốp pha', amount: 150_000_000, status: 'COORDINATION', advance: 60_000_000 },
    { title: 'Xi măng PCB40 – 200 tấn', amount: 280_000_000, status: 'ADVANCE_PAYMENT', advance: 140_000_000 },
  ];

  const ym = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  let n = 0;
  for (const s of samples) {
    n += 1;
    await prisma.paymentRequest.create({
      data: {
        ...base,
        code: `PYC-${ym}-${String(n).padStart(4, '0')}`,
        title: s.title,
        requestedAmount: s.amount,
        advanceAmount: s.advance ?? null,
        status: s.status,
        assignedAccountantId: s.status === 'ADVANCE_PAYMENT' ? accountant.id : null,
        priority: s.status === 'ADVANCE_PAYMENT' ? 'HIGH' : null,
        timeline: {
          create: [
            { action: 'CREATE', toStatus: 'DRAFT', actorId: requester.id },
            ...(s.status !== 'DRAFT' ? [{ action: 'T1' as const, fromStatus: 'DRAFT' as const, toStatus: 'LEADER_APPROVAL' as const, actorId: requester.id }] : []),
            ...(['ADVANCE_PREPARATION', 'COORDINATION', 'ADVANCE_PAYMENT'].includes(s.status)
              ? [{ action: 'T3' as const, fromStatus: 'LEADER_APPROVAL' as const, toStatus: 'ADVANCE_PREPARATION' as const, actorId: leader.id }]
              : []),
          ],
        },
      },
    });
  }
  await prisma.requestSequence.upsert({ where: { yearMonth: ym }, create: { yearMonth: ym, lastValue: n }, update: { lastValue: n } });
}

main()
  .catch((e) => {
    console.error('[seed] lỗi:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
