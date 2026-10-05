import { SLOT_DEF } from './constants.ts';
import type { Db, PaymentRequest, Slot, Status } from './types.ts';

export interface MissingDocumentInfo {
  slot: Slot;
  label: string;
  department: 'Phòng Cung Ứng' | 'Phòng Kế Toán';
  deptKind: 'PROCUREMENT' | 'ACCOUNTING';
  responsibleUserId: string | null;
  suggestedReturnStatus: Status;
  description: string;
}

export interface CompletedAudit {
  isComplete: boolean;
  requiredSlots: Slot[];
  attachedSlots: Slot[];
  missingDocuments: MissingDocumentInfo[];
  procurementMissing: MissingDocumentInfo[];
  accountingMissing: MissingDocumentInfo[];
  hasProcurementMissing: boolean;
  hasAccountingMissing: boolean;
  suggestedReturnStatus: Status;
}

/**
 * Checks completeness of all required attachments for a completed request.
 */
export function checkCompletedAttachments(db: Db, pr: PaymentRequest): CompletedAudit {
  const attachedSlots = new Set(
    db.attachments.filter((a) => a.requestId === pr.id).map((a) => a.slot),
  );
  const requiredSlots: Slot[] = [];
  const missingDocuments: MissingDocumentInfo[] = [];

  function requireSlot(
    slot: Slot,
    department: 'Phòng Cung Ứng' | 'Phòng Kế Toán',
    deptKind: 'PROCUREMENT' | 'ACCOUNTING',
    responsibleUserId: string | null,
    suggestedReturnStatus: Status,
    description: string,
  ) {
    requiredSlots.push(slot);
    if (!attachedSlots.has(slot)) {
      missingDocuments.push({
        slot,
        label: SLOT_DEF[slot].label,
        department,
        deptKind,
        responsibleUserId,
        suggestedReturnStatus,
        description,
      });
    }
  }

  // 1. Hồ sơ yêu cầu B1 (Phòng Cung Ứng)
  requireSlot(
    'REQUEST_FORM',
    'Phòng Cung Ứng',
    'PROCUREMENT',
    pr.assignedRequesterId,
    'DRAFT',
    'Phiếu yêu cầu mua sắm / thanh toán gốc',
  );
  requireSlot(
    'QUOTATION_COMPARISON',
    'Phòng Cung Ứng',
    'PROCUREMENT',
    pr.assignedRequesterId,
    'DRAFT',
    'Báo giá nhà cung cấp kèm bảng so sánh giá',
  );

  // 2. Hồ sơ tạm ứng (nếu có tạm ứng)
  const hasAdvance = (pr.advanceAmount ?? 0) > 0;
  if (hasAdvance) {
    requireSlot(
      'PURCHASE_ORDER',
      'Phòng Cung Ứng',
      'PROCUREMENT',
      pr.assignedRequesterId,
      'ADVANCE_PREPARATION',
      'Đơn đặt hàng (PO) đính kèm tạm ứng',
    );
    requireSlot(
      'ADVANCE_REQUEST',
      'Phòng Cung Ứng',
      'PROCUREMENT',
      pr.assignedRequesterId,
      'ADVANCE_PREPARATION',
      'Giấy đề nghị tạm ứng',
    );
    requireSlot(
      'ADVANCE_PROOF',
      'Phòng Kế Toán',
      'ACCOUNTING',
      pr.assignedAccountantId,
      'ADVANCE_PAYMENT',
      'UNC / Phiếu chi tiền tạm ứng',
    );
  }

  // 3. Hồ sơ nghiệm thu & thanh toán B6 (Phòng Cung Ứng)
  requireSlot(
    'DELIVERY_RECORD',
    'Phòng Cung Ứng',
    'PROCUREMENT',
    pr.assignedRequesterId,
    'AFTER_ADVANCE',
    'Biên bản nghiệm thu / giao nhận hàng hóa',
  );
  requireSlot(
    'PAYMENT_REQUEST_DOC',
    'Phòng Cung Ứng',
    'PROCUREMENT',
    pr.assignedRequesterId,
    'AFTER_ADVANCE',
    'Giấy đề nghị thanh toán (ĐNTT)',
  );

  // Hóa đơn GTGT nếu là loại chi Có hóa đơn
  if (pr.hasInvoice) {
    requireSlot(
      'INVOICE',
      'Phòng Cung Ứng',
      'PROCUREMENT',
      pr.assignedRequesterId,
      'DOCUMENT_SUPPLEMENT_REQUIRED',
      'Hóa đơn tài chính (GTGT)',
    );
  }

  // 4. Chứng từ chi đợt cuối B7 (Phòng Kế Toán) — chỉ bắt buộc khi B7 thực sự chi tiền.
  // Cùng phép tính với remainingOf() trong workflow.ts; không import để tránh vòng lặp
  // module, vì workflow.ts đã import file này.
  const adv = pr.advanceAmount ?? 0;
  const extraSpent = pr.settlementAmount ?? 0;
  const remaining = Math.max(0, pr.requestedAmount - extraSpent - adv);
  if (remaining > 0) {
    requireSlot(
      'FINAL_PROOF',
      'Phòng Kế Toán',
      'ACCOUNTING',
      pr.assignedAccountantId,
      'FINAL_PAYMENT',
      'UNC / Phiếu chi thanh toán đợt cuối',
    );
  }

  const procurementMissing = missingDocuments.filter((d) => d.deptKind === 'PROCUREMENT');
  const accountingMissing = missingDocuments.filter((d) => d.deptKind === 'ACCOUNTING');

  // Determine best suggested return status
  let suggestedReturnStatus: Status = 'DOCUMENT_SUPPLEMENT_REQUIRED';
  if (accountingMissing.length > 0) {
    suggestedReturnStatus = 'FINAL_PAYMENT';
  } else if (procurementMissing.some((m) => m.slot === 'DELIVERY_RECORD' || m.slot === 'PAYMENT_REQUEST_DOC')) {
    suggestedReturnStatus = 'AFTER_ADVANCE';
  } else if (procurementMissing.some((m) => m.slot === 'INVOICE')) {
    suggestedReturnStatus = 'DOCUMENT_SUPPLEMENT_REQUIRED';
  } else if (procurementMissing.some((m) => m.slot === 'PURCHASE_ORDER' || m.slot === 'ADVANCE_REQUEST')) {
    suggestedReturnStatus = 'ADVANCE_PREPARATION';
  } else if (procurementMissing.length > 0) {
    suggestedReturnStatus = 'DRAFT';
  }

  return {
    isComplete: missingDocuments.length === 0,
    requiredSlots,
    attachedSlots: [...attachedSlots],
    missingDocuments,
    procurementMissing,
    accountingMissing,
    hasProcurementMissing: procurementMissing.length > 0,
    hasAccountingMissing: accountingMissing.length > 0,
    suggestedReturnStatus,
  };
}

/**
 * Số phiếu đã hoàn thành mà hồ sơ còn thiếu chứng từ. Dùng cho badge ở menu
 * "Phiếu hoàn thành": còn thiếu thì hiện số, đủ hết thì không hiện gì.
 * Phiếu đã lưu trữ vẫn giữ nguyên bản ghi đính kèm nên không bị tính là thiếu.
 */
export function countCompletedMissingDocs(db: Db): number {
  let n = 0;
  for (const pr of db.requests) {
    if (pr.status !== 'COMPLETED') continue;
    if (!checkCompletedAttachments(db, pr).isComplete) n++;
  }
  return n;
}
