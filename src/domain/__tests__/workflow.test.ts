// Run: npm run test:domain  (Node >= 22.6 strips the TypeScript types natively)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { performAdmin, departmentForRole, type AdminAction } from '../admin.ts';
import { attemptLogin, changePassword } from '../auth.ts';
import { addWorkingDays, invoiceCountdown, toDateKey, workingDaysElapsed } from '../dates.ts';
import { DomainError, type ErrorCode } from '../errors.ts';
import { buildFileName, buildStoragePath, normalizeFileName } from '../files.ts';
import { runDailyJobs } from '../jobs.ts';
import { can, canDeleteAttachment, canUploadToSlot, findUser, queueItems, theAccountant } from '../permissions.ts';
import { SEED_ACCOUNTS, buildSeed, emptyDb } from '../seed.ts';
import { perform, remainingOf, settlementError, type DraftFields, type WorkflowAction } from '../workflow.ts';
import type { Db, PaymentRequest, Slot } from '../types.ts';

const hash = (id: string) => `h:${id}:Password@123`;
// A Wednesday, so "+N days" arithmetic in tests stays inside one working week unless intended.
const NOW = new Date(2026, 8, 23, 10, 0, 0);

const CU = 'u-cu';
const LD = 'u-ld';
const TC = 'u-tc';
const KT = 'u-kt';
const ADMIN = 'u-admin';

const FIELDS: DraftFields = {
  title: 'Thép D16',
  projectId: 'prj-1',
  categoryId: 'cat-1',
  requesterNameId: 'rqn-1',
  vendorId: 'ven-1',
  requestedAmount: 100_000_000,
  hasInvoice: true,
  note: '',
};

class World {
  db: Db;
  now: Date;
  id = '';
  constructor(db?: Db) {
    this.db = db ?? emptyDb(hash, NOW);
    this.now = new Date(NOW);
  }
  get pr(): PaymentRequest {
    return this.db.requests.find((r) => r.id === this.id)!;
  }
  run(actor: string, action: WorkflowAction) {
    this.now = new Date(this.now.getTime() + 60_000);
    const { db, result } = perform(this.db, actor, action, this.now);
    this.db = db;
    if (result.requestId) this.id = result.requestId;
    return result;
  }
  admin(actor: string, action: AdminAction) {
    this.db = performAdmin(this.db, actor, action, this.now).db;
  }
  t(actor: string, action: Record<string, unknown>) {
    return this.run(actor, { ...action, id: this.id, version: this.pr.version } as WorkflowAction);
  }
  attach(actor: string, slot: Slot, name = `${slot}.pdf`) {
    return this.run(actor, { type: 'ATTACH', id: this.id, slot, files: [{ fileName: name, size: 1000, mimeType: 'application/pdf' }] });
  }
  create(actor = CU, fields: Partial<DraftFields> = {}) {
    return this.run(actor, { type: 'CREATE_REQUEST', fields: { ...FIELDS, ...fields } });
  }
  b1(actor = CU) {
    this.attach(actor, 'REQUEST_FORM');
    this.attach(actor, 'QUOTATION_COMPARISON');
  }
  toB3() {
    this.create();
    this.b1();
    this.t(CU, { type: 'SUBMIT', confirmed: true });
    this.t(LD, { type: 'LEADER_APPROVE', confirmed: true });
  }
  toB4(advance = 40_000_000) {
    this.toB3();
    this.attach(CU, 'PURCHASE_ORDER');
    this.attach(CU, 'ADVANCE_REQUEST');
    this.t(CU, { type: 'SUBMIT_ADVANCE', confirmed: true, advanceAmount: advance });
  }
  toB5() {
    this.toB4();
    this.t(TC, { type: 'FINANCE_APPROVE', confirmed: true, priority: 'HIGH', accountantNameId: 'ktn-1' });
  }
  toB6() {
    this.toB5();
    this.attach(KT, 'ADVANCE_PROOF');
    this.t(KT, { type: 'PAY_ADVANCE', checkedDocs: true, paid: true, method: 'TRANSFER', paidDate: '2026-09-23' });
  }
  toB7(settlement = 100_000_000) {
    this.toB6();
    this.attach(CU, 'DELIVERY_RECORD');
    this.attach(CU, 'PAYMENT_REQUEST_DOC');
    this.t(CU, { type: 'SUBMIT_SETTLEMENT', confirmed: true, settlementAmount: settlement });
  }
}

function expectCode(fn: () => unknown, code: ErrorCode) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof DomainError, `expected DomainError, got ${String(e)}`);
    assert.equal(e.code, code);
    return true;
  });
}

describe('Happy path B1 → B8 → COMPLETED', () => {
  it('runs T1, T3, T6, T7, T8, T9, T10→T12, T13 with notifications and a permanent timeline', () => {
    const w = new World();
    w.toB7();
    assert.equal(w.pr.status, 'FINAL_PAYMENT');
    assert.equal(w.pr.assignedAccountantId, KT, 'B4 auto-assigns the single accountant');

    w.attach(KT, 'FINAL_PROOF');
    const res = w.t(KT, { type: 'PAY_FINAL', checkedDocs: true, completed: true, method: 'TRANSFER', paidDate: '2026-09-24' });
    assert.equal(res.status, 'DOCUMENT_SUPPLEMENT_REQUIRED', 'has-invoice request without invoice goes to B8 (T12)');
    assert.ok(w.pr.invoiceDueStartAt);
    assert.deepEqual(
      w.pr.transactions.map((t) => [t.kind, t.amount]),
      [
        ['ADVANCE', 40_000_000],
        ['FINAL', 60_000_000],
      ],
    );

    w.attach(CU, 'INVOICE');
    w.t(CU, { type: 'COMPLETE_INVOICE' });
    assert.equal(w.pr.status, 'COMPLETED');
    assert.deepEqual(
      w.pr.timeline.map((t) => t.action),
      ['CREATE', 'T1', 'T3', 'T6', 'T7', 'T8', 'T9', 'T10', 'T12', 'T13'],
    );
    assert.ok(w.db.notifications.some((n) => n.userId === KT && n.title.includes('bổ sung hóa đơn')));
  });

  it('T10 → T11 directly when "Không hóa đơn" or the invoice was already uploaded at B6', () => {
    const w = new World();
    w.toB6();
    w.attach(CU, 'DELIVERY_RECORD');
    w.attach(CU, 'PAYMENT_REQUEST_DOC');
    w.attach(CU, 'INVOICE');
    w.t(CU, { type: 'SUBMIT_SETTLEMENT', confirmed: true, settlementAmount: 40_000_000 });
    // remaining = 0 → no final proof required
    const res = w.t(KT, { type: 'PAY_FINAL', checkedDocs: true, completed: true, method: null, paidDate: '2026-09-24' });
    assert.equal(res.status, 'COMPLETED');
    assert.equal(w.pr.transactions.length, 1);
  });

  it('never persists AUTO_VERIFY and covers every status in the seed', () => {
    const db = buildSeed(hash, NOW);
    assert.ok(db.requests.every((r) => (r.status as string) !== 'AUTO_VERIFY'));
    const statuses = new Set(db.requests.map((r) => r.status));
    for (const s of ['DRAFT', 'LEADER_APPROVAL', 'ADVANCE_PREPARATION', 'COORDINATION', 'ADVANCE_PAYMENT', 'AFTER_ADVANCE', 'FINAL_PAYMENT', 'DOCUMENT_SUPPLEMENT_REQUIRED', 'COMPLETED', 'CANCELLED', 'REJECTED']) {
      assert.ok(statuses.has(s as never), `seed covers ${s}`);
    }
  });
});

describe('B1 and B2', () => {
  it('requires fields, amount > 0 and both B1 files before T1', () => {
    const w = new World();
    expectCode(() => w.create(CU, { requestedAmount: 0 }), 'ERR_AMOUNT_NOT_POSITIVE');
    expectCode(() => w.create(CU, { vendorId: '' }), 'ERR_REQUIRED_FIELD');
    w.create();
    w.attach(CU, 'REQUEST_FORM');
    expectCode(() => w.t(CU, { type: 'SUBMIT', confirmed: true }), 'ERR_DOC_INCOMPLETE');
    w.attach(CU, 'QUOTATION_COMPARISON');
    expectCode(() => w.t(CU, { type: 'SUBMIT', confirmed: false }), 'ERR_PAYMENT_NO_CONFIRM');
    w.t(CU, { type: 'SUBMIT', confirmed: true });
    assert.equal(w.pr.status, 'LEADER_APPROVAL');
    assert.match(w.pr.code, /^PYC-202609-\d{4}$/);
  });

  it('T2 cancels at B1 without a reason, and only at B1', () => {
    const w = new World();
    w.create();
    w.t(CU, { type: 'CANCEL' });
    assert.equal(w.pr.status, 'CANCELLED');

    const v = new World();
    v.toB3();
    expectCode(() => v.t(CU, { type: 'CANCEL' }), 'ERR_INVALID_TRANSITION');
    v.toB5();
    expectCode(() => v.t(KT, { type: 'CANCEL' }), 'ERR_INVALID_TRANSITION');
  });

  it('every Leader sees B2; other roles cannot approve, reject or return', () => {
    const w = new World();
    w.create();
    w.b1();
    w.t(CU, { type: 'SUBMIT', confirmed: true });
    assert.equal(queueItems(w.db, findUser(w.db, LD)!, 'leaderApproval').length, 1);
    assert.equal(queueItems(w.db, findUser(w.db, TC)!, 'leaderApproval').length, 0);
    expectCode(() => w.t(TC, { type: 'LEADER_APPROVE', confirmed: true }), 'ERR_FORBIDDEN');
    expectCode(() => w.t(KT, { type: 'LEADER_REJECT', reason: 'x' }), 'ERR_FORBIDDEN');
    expectCode(() => w.t(LD, { type: 'LEADER_RETURN', reason: '  ' }), 'ERR_REASON_REQUIRED');
    w.t(LD, { type: 'LEADER_RETURN', reason: 'Bổ sung tiến độ' });
    assert.equal(w.pr.status, 'DRAFT');
    assert.equal(w.pr.resubmitted, true);
    assert.ok(w.db.notifications.some((n) => n.userId === CU && n.title === 'Lãnh đạo trả lại phiếu'));
  });

  it('blocks T1 when no Leader account is active, and alerts Admin', () => {
    const w = new World();
    w.admin(ADMIN, { type: 'SET_USER_STATUS', userId: LD, status: 'LOCKED' });
    w.create();
    w.b1();
    try {
      w.t(CU, { type: 'SUBMIT', confirmed: true });
      assert.fail('expected ERR_NO_LEADER');
    } catch (e) {
      assert.ok(e instanceof DomainError);
      assert.equal(e.code, 'ERR_NO_LEADER');
      assert.ok(e.alertAdmins);
    }
    assert.equal(w.pr.status, 'DRAFT', 'rejected action leaves the request untouched');
  });

  it('nobody approves at B2 a request they created themselves (workflow T3)', () => {
    const w = new World();
    // Admin creates on behalf of the requester, then swaps role to Leader to attempt self-approval.
    w.run(ADMIN, { type: 'CREATE_REQUEST', fields: FIELDS, assignedRequesterId: CU });
    w.b1(ADMIN);
    w.t(CU, { type: 'SUBMIT', confirmed: true });
    w.db.requests[0].createdBy = LD;
    expectCode(() => w.t(LD, { type: 'LEADER_APPROVE', confirmed: true }), 'ERR_SELF_APPROVAL');
  });
});

describe('B3, B4 and B5', () => {
  it('validates 0 < advance ≤ total and both files', () => {
    const w = new World();
    w.toB3();
    w.attach(CU, 'PURCHASE_ORDER');
    expectCode(() => w.t(CU, { type: 'SUBMIT_ADVANCE', confirmed: true, advanceAmount: 0 }), 'ERR_ADV_ZERO');
    expectCode(() => w.t(CU, { type: 'SUBMIT_ADVANCE', confirmed: true, advanceAmount: 100_000_001 }), 'ERR_ADV_EXCEED_TOTAL');
    expectCode(() => w.t(CU, { type: 'SUBMIT_ADVANCE', confirmed: true, advanceAmount: 100_000_000 }), 'ERR_DOC_INCOMPLETE');
  });

  it('B4 needs the tick and a priority, auto-assigns the accountant and posts the coordination note', () => {
    const w = new World();
    w.toB4();
    expectCode(() => w.t(TC, { type: 'FINANCE_APPROVE', confirmed: false, priority: 'HIGH', accountantNameId: 'ktn-1' }), 'ERR_PAYMENT_NO_CONFIRM');
    expectCode(() => w.t(TC, { type: 'FINANCE_APPROVE', confirmed: true, priority: null, accountantNameId: 'ktn-1' }), 'ERR_REQUIRED_FIELD');
    expectCode(() => w.t(KT, { type: 'FINANCE_APPROVE', confirmed: true, priority: 'HIGH', accountantNameId: 'ktn-1' }), 'ERR_FORBIDDEN');
    // B4 phải chỉ định nhân viên Kế toán; tên này hiện trên form của cả TPTC lẫn Kế toán.
    expectCode(() => w.t(TC, { type: 'FINANCE_APPROVE', confirmed: true, priority: 'HIGH', accountantNameId: '' }), 'ERR_REQUIRED_FIELD');
    expectCode(() => w.t(TC, { type: 'FINANCE_APPROVE', confirmed: true, priority: 'HIGH', accountantNameId: 'khong-co' }), 'ERR_NOT_FOUND');
    w.t(TC, { type: 'FINANCE_APPROVE', confirmed: true, priority: 'HIGH', accountantNameId: 'ktn-1', note: 'Chi gấp cho NCC' });
    assert.equal(w.pr.status, 'ADVANCE_PAYMENT');
    assert.equal(w.pr.assignedAccountantId, theAccountant(w.db)!.id);
    assert.equal(w.pr.priority, 'HIGH');
    assert.equal(w.pr.accountantNameId, 'ktn-1');
    assert.ok(w.db.comments.some((c) => c.requestId === w.id && c.content.startsWith('[TÀI CHÍNH ĐIỀU PHỐI]')));
    assert.ok(w.db.notifications.some((n) => n.userId === KT && n.title.includes('tạm ứng')));
  });

  it('B4 is blocked and Admin alerted when no accountant is active', () => {
    const w = new World();
    w.toB4();
    w.admin(ADMIN, { type: 'SET_USER_STATUS', userId: KT, status: 'LOCKED' });
    try {
      w.t(TC, { type: 'FINANCE_APPROVE', confirmed: true, priority: 'LOW', accountantNameId: 'ktn-1' });
      assert.fail('expected ERR_NO_ACCOUNTANT');
    } catch (e) {
      assert.ok(e instanceof DomainError && e.code === 'ERR_NO_ACCOUNTANT' && e.alertAdmins);
    }
    assert.equal(w.pr.status, 'COORDINATION');
  });

  it('B5 needs both ticks, method, date and the UNC file; only the assigned accountant may act', () => {
    const w = new World();
    w.toB5();
    const ok = { type: 'PAY_ADVANCE', checkedDocs: true, paid: true, method: 'TRANSFER', paidDate: '2026-09-23' };
    expectCode(() => w.t(TC, ok), 'ERR_FORBIDDEN');
    expectCode(() => w.t(KT, { ...ok, paid: false }), 'ERR_PAYMENT_NO_CONFIRM');
    expectCode(() => w.t(KT, ok), 'ERR_DOC_INCOMPLETE');
    w.attach(KT, 'ADVANCE_PROOF');
    w.t(KT, ok);
    assert.equal(w.pr.status, 'AFTER_ADVANCE');
  });
});

describe('B6 and B7 amounts', () => {
  it('refuses settlement < advance at the input and in the engine (workflow §6.2)', () => {
    assert.equal(settlementError(40_000_000, 55_000_000), null);
    assert.equal(settlementError(40_000_000, 40_000_000), null);
    assert.match(settlementError(40_000_000, 39_999_999) ?? '', /không được nhỏ hơn/);

    const w = new World();
    w.toB6();
    w.attach(CU, 'DELIVERY_RECORD');
    w.attach(CU, 'PAYMENT_REQUEST_DOC');
    expectCode(() => w.t(CU, { type: 'SUBMIT_SETTLEMENT', confirmed: true, settlementAmount: 39_999_999 }), 'ERR_SETTLE_BELOW_ADV');
    assert.equal(w.pr.status, 'AFTER_ADVANCE');
    w.t(CU, { type: 'SUBMIT_SETTLEMENT', confirmed: true, settlementAmount: 55_000_000 });
    assert.equal(w.pr.status, 'FINAL_PAYMENT');
    assert.equal(remainingOf(w.pr), 15_000_000);
  });

  it('remaining > 0 requires the final UNC at B7', () => {
    const w = new World();
    w.toB7(120_000_000);
    expectCode(
      () => w.t(KT, { type: 'PAY_FINAL', checkedDocs: true, completed: true, method: 'TRANSFER', paidDate: '2026-09-24' }),
      'ERR_FINAL_NO_PROOF',
    );
  });
});

describe('Admin privileges (Super Admin, workflow §5.2 and §9.1)', () => {
  it('A1 forces any status and only warns when skipping a payment step', () => {
    const w = new World();
    w.toB4();
    const res = w.t(ADMIN, { type: 'FORCE', toStatus: 'AFTER_ADVANCE', reason: 'Bỏ qua tạm ứng, NCC cho nợ' });
    assert.equal(w.pr.status, 'AFTER_ADVANCE');
    assert.match(res.warning ?? '', /chưa có giao dịch chi/);
    expectCode(() => w.t(TC, { type: 'FORCE', toStatus: 'DRAFT', reason: 'x' }), 'ERR_FORBIDDEN');
  });

  it('A1, A2, A3 and delete all work on a COMPLETED request', () => {
    const w = new World(buildSeed(hash, NOW));
    const done = w.db.requests.find((r) => r.status === 'COMPLETED')!;
    w.id = done.id;
    const code = done.code;
    w.t(ADMIN, { type: 'FORCE', toStatus: 'FINAL_PAYMENT', reason: 'Thiếu chứng từ, mở lại B7' });
    assert.equal(w.pr.status, 'FINAL_PAYMENT');
    w.t(ADMIN, { type: 'ADMIN_CANCEL', reason: 'Trùng phiếu' });
    assert.equal(w.pr.status, 'CANCELLED');
    w.t(ADMIN, { type: 'REOPEN', reason: 'Hủy nhầm' });
    assert.equal(w.pr.status, 'DRAFT');
    assert.equal(w.pr.code, code, 'A3 keeps the request code and history');
    w.t(ADMIN, { type: 'DELETE_REQUEST', reason: 'Dọn dữ liệu' });
    assert.equal(w.db.requests.some((r) => r.id === done.id), false);
  });

  it('A2 warns but does not block once money has been paid out', () => {
    const w = new World();
    w.toB6();
    const res = w.t(ADMIN, { type: 'ADMIN_CANCEL', reason: 'Dừng hợp đồng' });
    assert.equal(w.pr.status, 'CANCELLED');
    assert.match(res.warning ?? '', /giao dịch chi/);
  });

  it('A3 can reopen a completed request straight to a chosen step', () => {
    const w = new World(buildSeed(hash, NOW));
    w.id = w.db.requests.find((r) => r.status === 'COMPLETED')!.id;
    w.t(ADMIN, { type: 'REOPEN', reason: 'Bổ sung BNH', toStatus: 'AFTER_ADVANCE' });
    assert.equal(w.pr.status, 'AFTER_ADVANCE');
  });

  it('A4 hands the request to the new requester after a staff change, Admin only', () => {
    const w = new World();
    w.toB3();
    expectCode(() => w.run(CU, { type: 'TRANSFER', items: [{ id: w.id, version: w.pr.version }], toRequesterId: CU, reason: 'x' }), 'ERR_FORBIDDEN');
    // Only one active requester exists, so the seat is freed first and then refilled.
    w.admin(ADMIN, { type: 'SET_USER_STATUS', userId: CU, status: 'LOCKED' });
    w.admin(ADMIN, { type: 'CREATE_USER', input: { username: 'cungung2', fullName: 'Trần Thị Bình', role: 'REQUESTER' }, passwordHash: 'h' });
    const next = w.db.users.find((u) => u.username === 'cungung2')!;
    w.run(ADMIN, { type: 'TRANSFER', items: [{ id: w.id, version: w.pr.version }], toRequesterId: next.id, reason: 'An nghỉ việc' });
    assert.equal(w.pr.assignedRequesterId, next.id);
    assert.equal(w.pr.status, 'ADVANCE_PREPARATION', 'A4 never changes the status');
    assert.equal(queueItems(w.db, next, 'overview').length, 1);
  });

  it('Admin edits data and files on a completed request', () => {
    const w = new World(buildSeed(hash, NOW));
    const done = w.db.requests.find((r) => r.status === 'COMPLETED')!;
    w.id = done.id;
    w.t(ADMIN, { type: 'UPDATE_INFO', fields: { ...FIELDS, title: 'Sửa bởi Admin' } });
    assert.equal(w.pr.title, 'Sửa bởi Admin');
    w.attach(ADMIN, 'INVOICE', 'Hoa_don_bo_sung.pdf');
    assert.ok(w.db.attachments.some((a) => a.requestId === done.id && a.fileName === 'Hoa_don_bo_sung.pdf'));
  });

  it('business roles cannot touch a finished request', () => {
    const w = new World(buildSeed(hash, NOW));
    const done = w.db.requests.find((r) => r.status === 'COMPLETED')!;
    w.id = done.id;
    expectCode(() => w.t(CU, { type: 'UPDATE_INFO', fields: FIELDS }), 'ERR_INVALID_TRANSITION');
    expectCode(() => w.attach(CU, 'INVOICE'), 'ERR_FILE_LOCKED');
    expectCode(() => w.t(LD, { type: 'LEADER_APPROVE', confirmed: true }), 'ERR_INVALID_TRANSITION');
  });

  it('optimistic locking rejects a stale version', () => {
    const w = new World();
    w.create();
    w.b1();
    const stale = w.pr.version;
    w.t(CU, { type: 'SUBMIT', confirmed: true });
    expectCode(() => w.run(LD, { type: 'LEADER_APPROVE', id: w.id, version: stale, confirmed: true }), 'ERR_VERSION_CONFLICT');
  });
});

describe('Attachments lock by step and land in the right folder', () => {
  it('B1 files lock after T1 and reopen after T5; accountants only use payment slots', () => {
    const w = new World();
    w.create();
    w.b1();
    const file = w.db.attachments[0];
    const cu = () => findUser(w.db, CU)!;
    assert.ok(canDeleteAttachment(cu(), w.pr, file));
    w.t(CU, { type: 'SUBMIT', confirmed: true });
    assert.equal(canDeleteAttachment(cu(), w.pr, file), false);
    expectCode(() => w.run(CU, { type: 'DETACH', attachmentId: file.id }), 'ERR_FILE_LOCKED');
    w.t(LD, { type: 'LEADER_RETURN', reason: 'Sửa' });
    assert.ok(canDeleteAttachment(cu(), w.pr, file));

    const v = new World();
    v.toB7();
    const kt = findUser(v.db, KT)!;
    assert.equal(canUploadToSlot(kt, v.pr, 'INVOICE'), false);
    assert.ok(canUploadToSlot(kt, v.pr, 'FINAL_PROOF'));
    assert.ok(canUploadToSlot(findUser(v.db, CU)!, v.pr, 'INVOICE'));
    expectCode(() => v.attach(CU, 'DELIVERY_RECORD'), 'ERR_FILE_LOCKED');
  });

  it('stores CUNG_UNG and KE_TOAN files under /CHUNG_TU/{folder}/{date}/{code}/', () => {
    const w = new World();
    w.toB5();
    w.attach(KT, 'ADVANCE_PROOF', 'UNC tạm ứng.pdf');
    const code = w.pr.code;
    const day = toDateKey(w.now);
    const cuFile = w.db.attachments.find((a) => a.slot === 'REQUEST_FORM')!;
    const ktFile = w.db.attachments.find((a) => a.slot === 'ADVANCE_PROOF')!;
    assert.equal(cuFile.folder, 'CUNG_UNG');
    assert.equal(cuFile.storagePath, `/CHUNG_TU/CUNG_UNG/${day}/${code}/REQUEST_FORM.pdf`);
    assert.equal(ktFile.folder, 'KE_TOAN');
    assert.equal(ktFile.storagePath, `/CHUNG_TU/KE_TOAN/${day}/${code}/UNC_tam_ung.pdf`);
  });

  it('normalizes names and suffixes duplicates with _HHmmss', () => {
    assert.equal(normalizeFileName('Báo giá (đợt 1)'), 'Bao_gia_dot_1');
    const at = new Date(2026, 8, 25, 8, 5, 9);
    assert.equal(buildFileName('Báo giá.pdf', at), 'Bao_gia.pdf');
    assert.equal(buildFileName('Báo giá.pdf', at, ['Bao_gia.pdf']), 'Bao_gia_080509.pdf');
    assert.equal(buildStoragePath('CUNG_UNG', 'PYC-202609-0007', 'Bao_gia.pdf', at), '/CHUNG_TU/CUNG_UNG/2026-09-25/PYC-202609-0007/Bao_gia.pdf');
  });

  it('enforces whitelist and the 25 MB limit', () => {
    const w = new World();
    w.create();
    expectCode(() => w.attach(CU, 'REQUEST_FORM', 'virus.exe'), 'ERR_FILE_TYPE');
    expectCode(
      () => w.run(CU, { type: 'ATTACH', id: w.id, slot: 'QUOTATION_COMPARISON', files: [{ fileName: 'a.pdf', size: 26 * 1024 * 1024, mimeType: 'application/pdf' }] }),
      'ERR_FILE_TOO_LARGE',
    );
    assert.equal(w.db.config.maxFileSizeMb, 25);
  });
});

describe('Work queues (RLS)', () => {
  it('each role only sees its own queue; Tra cứu shows every request', () => {
    const db = buildSeed(hash, NOW);
    const u = (id: string) => findUser(db, id)!;
    assert.ok(queueItems(db, u(CU), 'overview').every((r) => ['DRAFT', 'ADVANCE_PREPARATION'].includes(r.status)));
    assert.ok(queueItems(db, u(KT), 'finalPayments').every((r) => r.assignedAccountantId === KT));
    assert.equal(queueItems(db, u(CU), 'coordination').length, 0);
    assert.equal(queueItems(db, u(TC), 'coordination').length, 1);
    assert.ok(queueItems(db, u(TC), 'financeMonitor').length > 0);
    assert.equal(queueItems(db, u(KT), 'financeMonitor').length, 0);
    // Tra cứu: everyone sees everything, including DRAFT (workflow §1.7).
    for (const id of [CU, LD, TC, KT, ADMIN]) {
      assert.equal(queueItems(db, u(id), 'all').length, db.requests.length);
    }
    const b7 = db.requests.find((r) => r.status === 'FINAL_PAYMENT')!;
    assert.equal(can(db, u(TC), b7, 'PAY_FINAL'), false);
    assert.equal(can(db, u(KT), b7, 'PAY_FINAL'), true);
  });
});

describe('Scheduler', () => {
  it('flags overdue B8 once a day without changing status, and purges audit older than 6 days', () => {
    let db = buildSeed(hash, NOW);
    assert.equal(db.config.auditRetentionDays, 6);
    const cutoff = 6 * 86400e3;
    assert.ok(db.audit.some((e) => NOW.getTime() - new Date(e.createdAt).getTime() > cutoff));
    db = runDailyJobs(db, NOW);
    const b8 = db.requests.find((r) => r.status === 'DOCUMENT_SUPPLEMENT_REQUIRED')!;
    assert.equal(b8.lateInvoice, true);
    assert.equal(b8.status, 'DOCUMENT_SUPPLEMENT_REQUIRED');
    assert.ok(db.audit.every((e) => NOW.getTime() - new Date(e.createdAt).getTime() <= cutoff));
    const count = db.notifications.length;
    const again = runDailyJobs(db, new Date(NOW.getTime() + 3600e3));
    assert.equal(again, db, 'second run on the same day is a no-op');
    assert.equal(again.notifications.length, count);
  });

  it('counts working days skipping weekends and holidays', () => {
    const holidays = [{ date: '2026-09-02', name: 'Quốc khánh' }];
    // Fri 2026-08-28 + 5 working days: Mon 31, Tue 1, (Wed 2 holiday), Thu 3, Fri 4, Mon 7
    assert.equal(toDateKey(addWorkingDays(new Date(2026, 7, 28), 5, holidays)), '2026-09-07');
    assert.equal(workingDaysElapsed(new Date(2026, 7, 28), new Date(2026, 8, 7), holidays), 5);
    assert.equal(invoiceCountdown(new Date(2026, 7, 28).toISOString(), new Date(2026, 8, 8), 5, holidays).overdue, true);
  });
});

describe('Authentication and the four fixed departments', () => {
  it('logs in by username (case-insensitive) and locks temporarily after 5 failures', () => {
    let r = attemptLogin(emptyDb(hash, NOW), 'CUNGUNG', hash(CU), NOW);
    assert.equal(r.outcome.ok, true);
    for (let i = 0; i < 4; i++) {
      r = attemptLogin(r.db, 'cungung', 'wrong', NOW);
      assert.equal(r.outcome.ok, false);
    }
    r = attemptLogin(r.db, 'cungung', 'wrong', NOW);
    assert.equal(!r.outcome.ok && r.outcome.code, 'ERR_ACCOUNT_TEMP_LOCKED');
    r = attemptLogin(r.db, 'cungung', hash(CU), new Date(NOW.getTime() + 60_000));
    assert.equal(!r.outcome.ok && r.outcome.code, 'ERR_ACCOUNT_TEMP_LOCKED');
    r = attemptLogin(r.db, 'cungung', hash(CU), new Date(NOW.getTime() + 16 * 60_000));
    assert.equal(r.outcome.ok, true);
    assert.ok(r.db.audit.filter((e) => e.action.startsWith('LOGIN')).length >= 7);
  });

  it('enforces a strong new password on change', () => {
    const db = emptyDb(hash, NOW);
    expectCode(() => changePassword(db, CU, hash(CU), 'n', 'short', NOW), 'ERR_WEAK_PASSWORD');
    const next = changePassword(db, CU, hash(CU), 'new-hash', 'Matkhau2026', NOW);
    assert.equal(findUser(next, CU)!.mustChangePassword, false);
  });

  it('has exactly four departments, one active account each, and Admin in none', () => {
    const db = buildSeed(hash, NOW);
    assert.deepEqual(db.departments.map((d) => d.name), ['Phòng Cung Ứng', 'Lãnh Đạo', 'Phòng Tài Chính', 'Phòng Kế Toán']);
    assert.equal(SEED_ACCOUNTS.length, 5);
    const deptOf = (id: string) => db.departments.find((d) => d.id === findUser(db, id)!.departmentId)?.name ?? null;
    assert.equal(deptOf(CU), 'Phòng Cung Ứng');
    assert.equal(deptOf(LD), 'Lãnh Đạo');
    assert.equal(deptOf(TC), 'Phòng Tài Chính');
    assert.equal(deptOf(KT), 'Phòng Kế Toán');
    assert.equal(findUser(db, ADMIN)!.departmentId, null);
    assert.equal(departmentForRole(db, 'ACCOUNTANT'), 'dep-kt');
  });

  it('keeps one active account per department, at least one Admin, and unique usernames', () => {
    const db = emptyDb(hash, NOW);
    const input = { username: 'cungung2', fullName: 'X', role: 'REQUESTER' as const };
    expectCode(() => performAdmin(db, ADMIN, { type: 'CREATE_USER', input, passwordHash: 'h' }, NOW), 'ERR_DEPARTMENT_OCCUPIED');
    expectCode(() => performAdmin(db, ADMIN, { type: 'CREATE_USER', input: { ...input, username: 'CUNGUNG' }, passwordHash: 'h' }, NOW), 'ERR_DUPLICATE_USERNAME');
    expectCode(() => performAdmin(db, ADMIN, { type: 'SET_USER_STATUS', userId: ADMIN, status: 'LOCKED' }, NOW), 'ERR_LAST_ADMIN');
    expectCode(() => performAdmin(db, CU, { type: 'SET_USER_STATUS', userId: LD, status: 'LOCKED' }, NOW), 'ERR_FORBIDDEN');
    // A department frees up once its holder is locked.
    const locked = performAdmin(db, ADMIN, { type: 'SET_USER_STATUS', userId: CU, status: 'LOCKED' }, NOW).db;
    const created = performAdmin(locked, ADMIN, { type: 'CREATE_USER', input, passwordHash: 'h' }, NOW).db;
    assert.equal(created.users.find((u) => u.username === 'cungung2')!.departmentId, 'dep-cu', 'department follows the role');
  });

  it('refuses to delete an account that still owns requests', () => {
    const db = buildSeed(hash, NOW);
    expectCode(() => performAdmin(db, ADMIN, { type: 'DELETE_USER', userId: CU }, NOW), 'ERR_USER_IN_USE');
    expectCode(() => performAdmin(db, ADMIN, { type: 'DELETE_USER', userId: ADMIN }, NOW), 'ERR_CANNOT_DELETE_SELF');
  });

  it('master data: requester may edit projects but not departments; in-use items cannot be deleted', () => {
    const w = new World();
    w.create();
    expectCode(() => w.admin(CU, { type: 'DELETE_MASTER', kind: 'projects', id: 'prj-1' }), 'ERR_MASTER_DATA_IN_USE');
    w.admin(CU, { type: 'DELETE_MASTER', kind: 'projects', id: 'prj-2' });
    assert.equal(w.db.projects.find((p) => p.id === 'prj-2')!.deleted, true);
    expectCode(() => w.admin(CU, { type: 'SAVE_DEPARTMENT', id: 'dep-cu', code: 'X', name: 'X' }), 'ERR_FORBIDDEN');
    expectCode(() => w.admin(LD, { type: 'SAVE_MASTER', kind: 'vendors', code: 'N', name: 'NCC mới' }), 'ERR_FORBIDDEN');
  });
});
