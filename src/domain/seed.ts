// Demo data. Requests are driven through the real engine (perform) so every seeded state is reachable and valid.
import { AUDIT_RETENTION_DAYS, DEFAULT_ALLOWED_EXTENSIONS, MAX_FILE_SIZE_MB } from './constants.ts';
import { toDateKey } from './dates.ts';
import { performAdmin, departmentForRole, type AdminAction } from './admin.ts';
import { perform, type DraftFields, type WorkflowAction } from './workflow.ts';
import type { Db, Department, MasterItem, Role, Slot, User } from './types.ts';

/** Bump when the Db shape or demo structure changes — browsers holding older data are re-seeded. */
export const SCHEMA_VERSION = 34;

export interface SeedAccount {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

/** Exactly one account per department, plus Admin (workflow §11.2). */
export const SEED_ACCOUNTS: SeedAccount[] = [
  { id: 'u-cu', username: 'cungung', fullName: 'Nguyễn Văn An', role: 'REQUESTER' },
  { id: 'u-ld', username: 'lanhdao', fullName: 'Phạm Quốc Hùng', role: 'LEADER' },
  { id: 'u-tc', username: 'taichinh', fullName: 'Lê Thị Hằng', role: 'FINANCE_MANAGER' },
  { id: 'u-kt', username: 'ketoan', fullName: 'Đỗ Thị Thu', role: 'ACCOUNTANT' },
  { id: 'u-admin', username: 'admin', fullName: 'Quản trị hệ thống', role: 'ADMIN' },
];

/** The four fixed departments, one per kind (workflow §2b). */
const DEPARTMENTS: Department[] = [
  { id: 'dep-cu', code: 'CU', name: 'Phòng Cung Ứng', kind: 'PROCUREMENT' },
  { id: 'dep-ld', code: 'LD', name: 'Lãnh Đạo', kind: 'BOARD' },
  { id: 'dep-tc', code: 'TC', name: 'Phòng Tài Chính', kind: 'FINANCE' },
  { id: 'dep-kt', code: 'KT', name: 'Phòng Kế Toán', kind: 'ACCOUNTING' },
];

const item = (id: string, code: string, name: string): MasterItem => ({ id, code, name, deleted: false });

const PROJECTS = [
  item('prj-1', 'DA-01', 'Chung cư Hoàng Mai – Block A'),
  item('prj-2', 'DA-02', 'Nhà xưởng KCN Quế Võ'),
  item('prj-3', 'DA-03', 'Cải tạo văn phòng trụ sở'),
];
const CATEGORIES = [
  item('cat-1', 'VT', 'Vật tư chính'),
  item('cat-2', 'CM', 'Thuê ca máy'),
  item('cat-3', 'NC', 'Nhân công thầu phụ'),
  item('cat-4', 'CPC', 'Chi phí chung công trường'),
];
const REQUESTER_NAMES = [
  item('rqn-1', 'CHT-01', 'Chỉ huy trưởng – Trần Đức Long'),
  item('rqn-2', 'KS-02', 'Kỹ sư giám sát – Ngô Thanh Tâm'),
  item('rqn-3', 'HC-01', 'Hành chính – Lý Thu Trang'),
];
const ACCOUNTANT_NAMES = [
  item('ktn-1', 'KT-01', 'Kế toán viên – Đỗ Thị Thu'),
  item('ktn-2', 'KT-02', 'Kế toán viên – Vũ Minh Khoa'),
];
const VENDORS = [
  item('ven-1', 'NCC-001', 'Công ty TNHH Thép Việt Á'),
  item('ven-2', 'NCC-002', 'Công ty CP Bê tông Hà Nội'),
  item('ven-3', 'NCC-003', 'Công ty TNHH Máy xây dựng Phú Cường'),
  item('ven-4', 'NCC-004', 'Hộ kinh doanh Văn phòng phẩm Minh Châu'),
];

export function emptyDb(hashFor: (userId: string) => string, now: Date): Db {
  const departments = structuredClone(DEPARTMENTS);
  const deptOf = (role: Role) => departments.find((d) => d.kind === ROLE_KIND[role])?.id ?? null;
  const users: User[] = SEED_ACCOUNTS.map((a) => ({
    id: a.id,
    username: a.username,
    fullName: a.fullName,
    passwordHash: hashFor(a.id),
    mustChangePassword: false,
    role: a.role,
    departmentId: deptOf(a.role),
    status: 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: now.toISOString(),
  }));
  const y = now.getFullYear();
  return {
    schemaVersion: SCHEMA_VERSION,
    users,
    departments,
    projects: structuredClone(PROJECTS),
    categories: structuredClone(CATEGORIES),
    requesterNames: structuredClone(REQUESTER_NAMES),
    accountantNames: structuredClone(ACCOUNTANT_NAMES),
    vendors: structuredClone(VENDORS),
    requests: [],
    attachments: [],
    comments: [],
    notifications: [],
    audit: [],
    holidays: [
      { date: `${y}-01-01`, name: 'Tết Dương lịch' },
      { date: `${y}-04-30`, name: 'Ngày Giải phóng miền Nam' },
      { date: `${y}-05-01`, name: 'Quốc tế Lao động' },
      { date: `${y}-09-01`, name: 'Nghỉ Quốc khánh' },
      { date: `${y}-09-02`, name: 'Quốc khánh' },
    ],
    config: {
      invoiceDeadlineWorkingDays: 5,
      maxLoginAttempts: 5,
      lockMinutes: 15,
      maxFileSizeMb: MAX_FILE_SIZE_MB,
      auditRetentionDays: AUDIT_RETENTION_DAYS,
      allowedExtensions: [...DEFAULT_ALLOWED_EXTENSIONS],
    },
    seq: {},
    idCounter: 0,
  };
}

const ROLE_KIND: Record<Role, Department['kind'] | null> = {
  REQUESTER: 'PROCUREMENT',
  LEADER: 'BOARD',
  FINANCE_MANAGER: 'FINANCE',
  ACCOUNTANT: 'ACCOUNTING',
  ADMIN: null,
};

// ---------------------------------------------------------------------------
// Scripted demo requests
// ---------------------------------------------------------------------------

const CU = 'u-cu';
const LD = 'u-ld';
const TC = 'u-tc';
const KT = 'u-kt';

class Script {
  db: Db;
  private readonly base: Date;
  private minute = 0;
  private dayOffset = 0;
  id = '';

  constructor(db: Db, base: Date) {
    this.db = db;
    this.base = base;
  }

  /** Move the script clock to `days` days before base (09:00 + a few minutes per action). */
  at(daysAgo: number): this {
    this.dayOffset = daysAgo;
    this.minute = 0;
    return this;
  }

  private clock(): Date {
    const d = new Date(this.base);
    d.setDate(d.getDate() - this.dayOffset);
    d.setHours(9, this.minute, 0, 0);
    this.minute += 7;
    return d;
  }

  do(actor: string, action: WorkflowAction): this {
    const { db, result } = perform(this.db, actor, action, this.clock());
    this.db = db;
    if (result.requestId) this.id = result.requestId;
    return this;
  }

  admin(actor: string, action: AdminAction): this {
    this.db = performAdmin(this.db, actor, action, this.clock()).db;
    return this;
  }

  get version(): number {
    return this.db.requests.find((r) => r.id === this.id)!.version;
  }

  create(fields: Partial<DraftFields>): this {
    return this.do(CU, {
      type: 'CREATE_REQUEST',
      fields: {
        title: 'Yêu cầu chi',
        projectId: 'prj-1',
        categoryId: 'cat-1',
        requesterNameId: 'rqn-1',
        vendorId: 'ven-1',
        requestedAmount: 100_000_000,
        hasInvoice: true,
        note: '',
        ...fields,
      },
    });
  }

  attach(actor: string, slot: Slot, fileName: string, size = 180_000): this {
    const mime = fileName.endsWith('.pdf')
      ? 'application/pdf'
      : fileName.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'image/jpeg';
    return this.do(actor, { type: 'ATTACH', id: this.id, slot, files: [{ fileName, size, mimeType: mime }] });
  }

  /** The two mandatory B1 attachments. */
  b1Files(tag: string): this {
    return this.attach(CU, 'REQUEST_FORM', `Phieu_yeu_cau_${tag}.pdf`).attach(
      CU,
      'QUOTATION_COMPARISON',
      `Bao_gia_va_so_sanh_gia_${tag}.xlsx`,
    );
  }

  t(actor: string, action: Omit<WorkflowAction, 'id' | 'version'> & Record<string, unknown>): this {
    return this.do(actor, { ...action, id: this.id, version: this.version } as WorkflowAction);
  }

  /** B1 → B2 → B3. */
  toB3(): this {
    return this.t(CU, { type: 'SUBMIT', confirmed: true }).t(LD, { type: 'LEADER_APPROVE', confirmed: true, note: 'Đồng ý chủ trương' });
  }

  /** B3 → B4. */
  toB4(advance: number, tag: string): this {
    return this.attach(CU, 'PURCHASE_ORDER', `Don_dat_hang_${tag}.pdf`)
      .attach(CU, 'ADVANCE_REQUEST', `De_nghi_tam_ung_${tag}.pdf`)
      .t(CU, { type: 'SUBMIT_ADVANCE', confirmed: true, advanceAmount: advance });
  }

  /** B4 → B5. */
  toB5(priority: 'HIGH' | 'MEDIUM' | 'LOW', note?: string): this {
    return this.t(TC, { type: 'FINANCE_APPROVE', confirmed: true, priority, accountantNameId: 'ktn-1', note });
  }

  /** B5 → B6. */
  toB6(tag: string, daysAgo: number): this {
    return this.attach(KT, 'ADVANCE_PROOF', `UNC_tam_ung_${tag}.pdf`).t(KT, {
      type: 'PAY_ADVANCE',
      checkedDocs: true,
      paid: true,
      method: 'TRANSFER',
      paidDate: dateKey(this.base, daysAgo),
    });
  }

  /** B6 → B7. */
  toB7(settlement: number, tag: string, withInvoice: boolean): this {
    this.attach(CU, 'DELIVERY_RECORD', `Bien_ban_nghiem_thu_${tag}.pdf`).attach(
      CU,
      'PAYMENT_REQUEST_DOC',
      `De_nghi_thanh_toan_${tag}.pdf`,
    );
    if (withInvoice) this.attach(CU, 'INVOICE', `Hoa_don_${tag}.pdf`);
    return this.t(CU, { type: 'SUBMIT_SETTLEMENT', confirmed: true, settlementAmount: settlement });
  }

  /** B7 → COMPLETED or B8. */
  finish(tag: string, daysAgo: number): this {
    return this.attach(KT, 'FINAL_PROOF', `UNC_dot_cuoi_${tag}.pdf`).t(KT, {
      type: 'PAY_FINAL',
      checkedDocs: true,
      completed: true,
      method: 'TRANSFER',
      paidDate: dateKey(this.base, daysAgo),
    });
  }
}

export function buildSeed(hashFor: (userId: string) => string, now: Date): Db {
  const s = new Script(emptyDb(hashFor, now), now);

  // 1. B1 — draft still missing one required file
  s.at(1)
    .create({
      title: 'Mua văn phòng phẩm quý IV',
      projectId: 'prj-3',
      categoryId: 'cat-4',
      requesterNameId: 'rqn-3',
      vendorId: 'ven-4',
      requestedAmount: 8_500_000,
    })
    .attach(CU, 'REQUEST_FORM', 'Phieu_yeu_cau_VPP.pdf');

  // 2. B2 — waiting for Lãnh đạo
  s.at(1).create({ title: 'Thép cuộn D10 cho sàn tầng 5', requestedAmount: 245_000_000 }).b1Files('thep_D10');
  s.t(CU, { type: 'SUBMIT', confirmed: true });

  // 3. B1 — returned by Lãnh đạo (resubmitted flag)
  s.at(3).create({ title: 'Thuê máy đào 1,2m³ tháng 10', categoryId: 'cat-2', vendorId: 'ven-3', requestedAmount: 96_000_000 }).b1Files('may_dao');
  s.t(CU, { type: 'SUBMIT', confirmed: true })
    .at(2)
    .t(LD, { type: 'LEADER_RETURN', reason: 'Bảng so sánh mới có 2 NCC, cần tối thiểu 3 báo giá.' });

  // 4. B3 — approved, waiting for advance documents
  s.at(4).create({ title: 'Thiết bị đo đạc cho phòng Kỹ thuật', projectId: 'prj-2', categoryId: 'cat-4', requesterNameId: 'rqn-2', vendorId: 'ven-3', requestedAmount: 56_000_000 }).b1Files('thiet_bi_do');
  s.toB3();

  // 5. B4 — waiting for TPTC
  s.at(5).create({ title: 'Nhân công lắp dựng cốp pha', categoryId: 'cat-3', vendorId: 'ven-2', requestedAmount: 150_000_000 }).b1Files('cop_pha');
  s.toB3().toB4(60_000_000, 'cop_pha');

  // 6. B5 — dispatched to Kế toán, high priority
  s.at(6).create({ title: 'Xi măng PCB40 – 200 tấn', vendorId: 'ven-2', requestedAmount: 280_000_000 }).b1Files('xi_mang');
  s.toB3().toB4(140_000_000, 'xi_mang').at(5).toB5('HIGH', 'NCC yêu cầu tạm ứng trước khi giao hàng');

  // 7. B6 — advance paid, tracking settlement
  s.at(9).create({ title: 'Thuê cẩu tháp tháng 9', categoryId: 'cat-2', vendorId: 'ven-3', requestedAmount: 120_000_000 }).b1Files('cau_thap');
  s.toB3().toB4(50_000_000, 'cau_thap').at(8).toB5('MEDIUM').toB6('cau_thap', 8);

  // 8. B7 — settlement above the requested total (warning for the accountant), invoice still missing
  s.at(14).create({ title: 'Gạch block xây tường bao', vendorId: 'ven-2', requestedAmount: 120_000_000 }).b1Files('gach_block');
  s.toB3()
    .toB4(60_000_000, 'gach_block')
    .at(13)
    .toB5('MEDIUM')
    .toB6('gach_block', 13)
    .at(2)
    .toB7(126_500_000, 'gach_block', false);

  // 9. B8 — overdue invoice (the daily job raises the late flag)
  s.at(20).create({ title: 'Cát vàng bê tông – 500 m³', vendorId: 'ven-2', requestedAmount: 175_000_000 }).b1Files('cat_vang');
  s.toB3()
    .toB4(80_000_000, 'cat_vang')
    .at(19)
    .toB5('LOW')
    .toB6('cat_vang', 19)
    .at(16)
    .toB7(172_000_000, 'cat_vang', false)
    .at(14)
    .finish('cat_vang', 14);

  // 10. COMPLETED — "Không hóa đơn"
  s.at(25).create({ title: 'Khoán nhân công dọn vệ sinh công trường', categoryId: 'cat-3', vendorId: 'ven-4', requestedAmount: 18_000_000, hasInvoice: false }).b1Files('ve_sinh');
  s.toB3()
    .toB4(9_000_000, 've_sinh')
    .at(24)
    .toB5('LOW')
    .toB6('ve_sinh', 24)
    .at(21)
    .toB7(18_000_000, 've_sinh', false)
    .at(20)
    .finish('ve_sinh', 20);

  // 11. CANCELLED — cancelled by the requester at B1 (no reason needed)
  s.at(7).create({ title: 'Mua máy khoan cầm tay', categoryId: 'cat-4', vendorId: 'ven-3', requestedAmount: 12_000_000 }).b1Files('may_khoan');
  s.t(CU, { type: 'CANCEL' });

  // 12. REJECTED — refused by Lãnh đạo
  s.at(10).create({ title: 'Sơn chống thấm mái – nhập khẩu', requestedAmount: 410_000_000 }).b1Files('son');
  s.t(CU, { type: 'SUBMIT', confirmed: true })
    .at(9)
    .t(LD, { type: 'LEADER_REJECT', reason: 'Vượt dự toán hạng mục hoàn thiện, dùng sơn nội theo thiết kế.' });

  // Comments with @mentions on the two requests still in flight
  const b7 = s.db.requests.find((r) => r.status === 'FINAL_PAYMENT')!;
  s.do(KT, { type: 'COMMENT', id: b7.id, content: '@cungung Quyết toán vượt tổng đề nghị 6,5 triệu, bổ sung phụ lục khối lượng giúp mình nhé.' });
  const b8 = s.db.requests.find((r) => r.status === 'DOCUMENT_SUPPLEMENT_REQUIRED')!;
  s.do(KT, { type: 'COMMENT', id: b8.id, content: '@cungung NCC đã xuất hóa đơn chưa em? Phiếu đã quá hạn bổ sung.' });

  return s.db;
}

function dateKey(now: Date, daysAgo: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  return toDateKey(d);
}

export { departmentForRole };
