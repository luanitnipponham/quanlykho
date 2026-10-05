import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bell,
  CheckCircle2,
  FileCheck2,
  FileText,
  Inbox,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { navigate } from '../../app/router';
import { useDb, useMe } from '../../data/hooks';
import { store } from '../../data/store';
import { checkCompletedAttachments } from '../../domain/completedAudit';
import { SLOT_DEF, SLOT_GROUPS } from '../../domain/constants';
import type { PaymentRequest, Status } from '../../domain/types';
import { cx, formatMoney } from '../../lib/format';
import { masterName, userName } from '../../lib/lookup';
import { Button, Card, EmptyState, Field, Input, Modal, Notice, PageHeader, Select, Stat, Tabs, Textarea } from '../../ui/primitives';

import { attempt } from '../../ui/toast';

type FilterTab = 'ALL' | 'MISSING' | 'COMPLETE' | 'MISSING_PROC' | 'MISSING_ACCT';

export function CompletedRequestsPage() {
  const db = useDb();
  const me = useMe();

  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
  const [search, setSearch] = useState('');

  // Modals state
  const [inspectPr, setInspectPr] = useState<PaymentRequest | null>(null);
  const [notifyPr, setNotifyPr] = useState<PaymentRequest | null>(null);
  const [returnPr, setReturnPr] = useState<PaymentRequest | null>(null);
  const [deletePr, setDeletePr] = useState<PaymentRequest | null>(null);
  const [archivePr, setArchivePr] = useState<PaymentRequest | null>(null);

  // Form states for modals
  const [notifyNote, setNotifyNote] = useState('');
  const [returnToStatus, setReturnToStatus] = useState<Status>('DOCUMENT_SUPPLEMENT_REQUIRED');
  const [returnReason, setReturnReason] = useState('');
  const [deleteReason, setDeleteReason] = useState('');

  // All completed requests
  const completedList = useMemo(() => {
    return db.requests.filter((r) => r.status === 'COMPLETED');
  }, [db.requests]);

  // Audited completed requests with their attachment completeness
  const auditedList = useMemo(() => {
    return completedList.map((pr) => {
      const audit = checkCompletedAttachments(db, pr);
      return { pr, audit };
    });
  }, [completedList, db]);

  // Statistics
  const totalCount = auditedList.length;
  const completeCount = auditedList.filter((x) => x.audit.isComplete).length;
  const missingCount = auditedList.filter((x) => !x.audit.isComplete).length;
  const procMissingCount = auditedList.filter((x) => x.audit.hasProcurementMissing).length;
  const acctMissingCount = auditedList.filter((x) => x.audit.hasAccountingMissing).length;

  // Filtered rows
  const filteredRows = useMemo(() => {
    let list = auditedList;

    if (activeTab === 'MISSING') {
      list = list.filter((x) => !x.audit.isComplete);
    } else if (activeTab === 'COMPLETE') {
      list = list.filter((x) => x.audit.isComplete);
    } else if (activeTab === 'MISSING_PROC') {
      list = list.filter((x) => x.audit.hasProcurementMissing);
    } else if (activeTab === 'MISSING_ACCT') {
      list = list.filter((x) => x.audit.hasAccountingMissing);
    }

    const q = search.trim().toLowerCase();
    if (!q) return list;

    return list.filter(({ pr }) => {
      const text = [
        pr.code,
        pr.title,
        masterName(db, 'projects', pr.projectId),
        masterName(db, 'vendors', pr.vendorId),
        userName(db, pr.assignedRequesterId),
        userName(db, pr.assignedAccountantId),
        masterName(db, 'accountantNames', pr.accountantNameId),
      ]
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [auditedList, activeTab, search, db]);

  const isAdminUser = me.role === 'ADMIN';

  return (
    <>
      <PageHeader
        title="Phiếu hoàn thành & Kiểm tra chứng từ"
        description="Tự động kiểm tra tính đầy đủ của toàn bộ chứng từ đính kèm theo quy trình. Phát hiện các phiếu thiếu chứng từ, gửi thông báo đôn đốc bộ phận phụ trách và cho phép Quản trị viên (Admin) thu hồi trả về hoặc xóa phiếu."
      />

      {/* KPI Summary Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Tổng phiếu hoàn thành"
          value={totalCount}
          hint="Hồ sơ đã kết thúc luồng"
        />
        <Stat
          label="Đủ chứng từ hợp lệ"
          value={completeCount}
          tone="ok"
          hint={`${totalCount ? Math.round((completeCount / totalCount) * 100) : 0}% hồ sơ đầy đủ`}
        />
        <Stat
          label="Thiếu chứng từ đính kèm"
          value={missingCount}
          tone={missingCount > 0 ? 'danger' : 'default'}
          hint={missingCount > 0 ? 'Cần kiểm tra & bổ sung' : 'Không có phiếu thiếu'}
        />
        <Stat
          label="Theo bộ phận làm thiếu"
          value={`${procMissingCount} CU / ${acctMissingCount} KT`}
          tone={procMissingCount > 0 || acctMissingCount > 0 ? 'warn' : 'default'}
          hint="Cung Ứng & Kế Toán"
        />
      </div>

      <Card>
        {/* Filter Tabs */}
        <div className="border-b border-slate-100 px-4 pt-3 pb-3">
          <Tabs
            value={activeTab}
            onChange={(val) => setActiveTab(val as FilterTab)}
            items={[
              { value: 'ALL', label: `Tất cả (${totalCount})` },
              {
                value: 'MISSING',
                label: `⚠ Thiếu chứng từ (${missingCount})`,
              },
              { value: 'COMPLETE', label: `✓ Đủ chứng từ (${completeCount})` },
              { value: 'MISSING_PROC', label: `Phòng Cung Ứng thiếu (${procMissingCount})` },
              { value: 'MISSING_ACCT', label: `Phòng Kế Toán thiếu (${acctMissingCount})` },
            ]}
          />
        </div>

        {/* Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã phiếu, nội dung, NCC, dự án..."
              className="h-9 pl-9"
            />
          </div>
          <p className="text-xs text-slate-500">
            Hiển thị <b>{filteredRows.length}</b> / {totalCount} phiếu hoàn thành
          </p>
        </div>

        {/* Content Table */}
        {filteredRows.length === 0 ? (
          <EmptyState
            title={search ? 'Không tìm thấy phiếu phù hợp' : 'Không có phiếu nào trong danh mục này'}
            icon={<Inbox className="h-8 w-8" />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Phiếu yêu cầu</th>
                  <th className="px-4 py-3 font-medium">NV Cung ứng</th>
                  <th className="px-4 py-3 font-medium">Kế toán phụ trách</th>
                  <th className="px-4 py-3 text-right font-medium">Quyết toán</th>
                  <th className="px-4 py-3 font-medium">Kiểm tra chứng từ</th>
                  <th className="px-4 py-3 text-right font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map(({ pr, audit }) => {
                  const isMissing = !audit.isComplete;

                  return (
                    <tr
                      key={pr.id}
                      className={cx(
                        'transition-colors hover:bg-slate-50/80',
                        isMissing ? 'bg-amber-50/20' : '',
                      )}
                    >
                      {/* Code & Title */}
                      <td className="max-w-[300px] px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => navigate(`/requests/${pr.id}`)}
                            className="font-mono text-xs font-semibold text-brand-600 hover:underline"
                          >
                            {pr.code}
                          </button>
                        </div>
                        <p className="truncate font-medium text-slate-900">{pr.title}</p>
                        <p className="truncate text-xs text-slate-500">
                          {masterName(db, 'projects', pr.projectId)} · {masterName(db, 'vendors', pr.vendorId)}
                        </p>
                      </td>

                      {/* Requester */}
                      <td className="px-4 py-3 text-slate-700">
                        <p className="font-medium text-xs text-slate-900">{userName(db, pr.assignedRequesterId)}</p>
                        <p className="text-[11px] text-slate-500">Phòng Cung Ứng</p>
                      </td>

                      {/* Accountant */}
                      <td className="px-4 py-3 text-slate-700">
                        <p className="font-medium text-xs text-slate-900">
                          {pr.accountantNameId
                            ? masterName(db, 'accountantNames', pr.accountantNameId)
                            : pr.assignedAccountantId
                              ? userName(db, pr.assignedAccountantId)
                              : '—'}
                        </p>
                        <p className="text-[11px] text-slate-500">Phòng Kế Toán</p>
                      </td>

                      {/* Amounts */}
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        <p className="font-semibold text-slate-900">
                          {formatMoney(pr.settlementAmount ?? pr.requestedAmount)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {pr.advanceAmount !== null && pr.advanceAmount > 0 ? (
                            <>
                              <span>Đã TƯ: {formatMoney(pr.advanceAmount)}</span>
                              <span className="text-emerald-600 font-medium"> · Đã tất toán</span>
                            </>
                          ) : (
                            <span className="text-emerald-600 font-medium">Đã tất toán 100%</span>
                          )}
                        </p>
                      </td>

                      {/* Audit Status */}
                      <td className="px-4 py-3">
                        {audit.isComplete ? (
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            Đủ {audit.attachedSlots.length}/{audit.requiredSlots.length} chứng từ
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1.5 max-w-sm">
                            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 border border-amber-300 w-fit">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                              Thiếu {audit.missingDocuments.length} chứng từ
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {audit.missingDocuments.slice(0, 3).map((m) => (
                                <span
                                  key={m.slot}
                                  className={cx(
                                    'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium',
                                    m.deptKind === 'PROCUREMENT'
                                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                      : 'bg-purple-50 text-purple-700 border border-purple-200',
                                  )}
                                  title={`${m.label} (${m.department}): ${m.description}`}
                                >
                                  {m.label} ({m.deptKind === 'PROCUREMENT' ? 'CU' : 'KT'})
                                </span>
                              ))}
                              {audit.missingDocuments.length > 3 && (
                                <span className="text-[11px] text-slate-500">
                                  +{audit.missingDocuments.length - 3} nữa
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Inspect Documents Button */}
                          <button
                            onClick={() => setInspectPr(pr)}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                            title="Kiểm tra chi tiết chứng từ đính kèm"
                            aria-label={`Kiểm tra ${pr.code}`}
                          >
                            <FileCheck2 className="h-4 w-4" />
                          </button>

                          {/* Notify Department Button */}
                          <button
                            onClick={() => {
                              setNotifyPr(pr);
                              setNotifyNote('');
                            }}
                            disabled={audit.isComplete}
                            className={cx(
                              'rounded p-1.5 transition-colors',
                              !audit.isComplete
                                ? 'text-amber-600 hover:bg-amber-50 hover:text-amber-800'
                                : 'text-slate-300 cursor-not-allowed',
                            )}
                            title={
                              !audit.isComplete
                                ? 'Gửi thông báo nhắc nhở bộ phận làm thiếu chứng từ'
                                : 'Phiếu đã có đầy đủ chứng từ, không cần gửi thông báo'
                            }
                            aria-label={`Thông báo thiếu ${pr.code}`}
                          >
                            <Bell className="h-4 w-4" />
                          </button>

                          {/* Admin: Return to Department */}
                          {isAdminUser && (
                            <button
                              onClick={() => {
                                setReturnPr(pr);
                                setReturnToStatus(audit.suggestedReturnStatus);
                                setReturnReason(`Thiếu chứng từ bắt buộc: ${audit.missingDocuments.map((m) => m.label).join(', ')}`);
                              }}
                              disabled={audit.isComplete}
                              className={cx(
                                'rounded p-1.5 transition-colors',
                                !audit.isComplete
                                  ? 'text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800'
                                  : 'text-slate-300 cursor-not-allowed',
                              )}
                              title={
                                !audit.isComplete
                                  ? 'Admin: Trả về bộ phận làm thiếu để bổ sung chứng từ'
                                  : 'Phiếu đã đầy đủ chứng từ, không được trả về'
                              }
                              aria-label={`Admin trả về ${pr.code}`}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}

                          {/* Admin: Lưu trữ / Phục hồi tệp đính kèm (A5) */}
                          {isAdminUser &&
                            (pr.archivedAt ? (
                              <button
                                onClick={async () => {
                                  await attempt(() => store.run({ type: 'RESTORE', id: pr.id, version: pr.version }));
                                }}
                                className="rounded p-1.5 text-amber-600 transition-colors hover:bg-amber-50 hover:text-amber-800"
                                title={`Đã lưu trữ ${new Date(pr.archivedAt).toLocaleDateString('vi-VN')} — bấm để kéo tệp từ NAS về`}
                                aria-label={`Phục hồi tệp của ${pr.code}`}
                              >
                                <ArchiveRestore className="h-4 w-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => setArchivePr(pr)}
                                className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                                title="Lưu trữ: chuyển tệp đính kèm sang NAS rồi xóa khỏi đĩa máy chủ, hồ sơ vẫn tra cứu được"
                                aria-label={`Lưu trữ tệp của ${pr.code}`}
                              >
                                <Archive className="h-4 w-4" />
                              </button>
                            ))}

                          {/* Admin: Delete Request */}
                          {isAdminUser && (
                            <button
                              onClick={() => {
                                setDeletePr(pr);
                                setDeleteReason(`Phiếu hoàn thành không hợp lệ do thiếu chứng từ: ${audit.missingDocuments.map((m) => m.label).join(', ')}`);
                              }}
                              disabled={audit.isComplete}
                              className={cx(
                                'rounded p-1.5 transition-colors',
                                !audit.isComplete
                                  ? 'text-red-500 hover:bg-red-50 hover:text-red-700'
                                  : 'text-slate-300 cursor-not-allowed',
                              )}
                              title={
                                !audit.isComplete
                                  ? 'Admin: Xóa phiếu hoàn thành thiếu chứng từ'
                                  : 'Phiếu đã đầy đủ chứng từ hợp lệ, không được xóa'
                              }
                              aria-label={`Xóa ${pr.code}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 1. Modal: Chi tiết kiểm tra chứng từ */}
      {/* ------------------------------------------------------------------ */}
      {inspectPr && (() => {
        const audit = checkCompletedAttachments(db, inspectPr);
        const attached = db.attachments.filter((a) => a.requestId === inspectPr.id);

        return (
          <Modal
            title={`Kiểm tra chứng từ hoàn thành — ${inspectPr.code}`}
            onClose={() => setInspectPr(null)}
            footer={
              <div className="flex w-full items-center justify-between">
                <Button variant="secondary" onClick={() => navigate(`/requests/${inspectPr.id}`)}>
                  Xem chi tiết phiếu
                </Button>
                <div className="flex gap-2">
                  {!audit.isComplete && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const target = inspectPr;
                        setInspectPr(null);
                        setNotifyPr(target);
                        setNotifyNote('');
                      }}
                    >
                      <Bell className="h-4 w-4 text-amber-600" /> Báo thiếu cho bộ phận
                    </Button>
                  )}
                  {isAdminUser && !audit.isComplete && (
                    <Button
                      variant="primary"
                      onClick={() => {
                        const target = inspectPr;
                        setInspectPr(null);
                        setReturnPr(target);
                        setReturnToStatus(audit.suggestedReturnStatus);
                        setReturnReason(`Thiếu chứng từ: ${audit.missingDocuments.map((m) => m.label).join(', ')}`);
                      }}
                    >
                      <RotateCcw className="h-4 w-4" /> Trả về bộ phận làm thiếu
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setInspectPr(null)}>
                    Đóng
                  </Button>
                </div>
              </div>
            }
          >
            <div className="space-y-5">
              {audit.isComplete ? (
                <Notice tone="ok">
                  <p className="font-semibold text-emerald-800">
                    Hồ sơ chứng từ đầy đủ 100% ({audit.attachedSlots.length}/{audit.requiredSlots.length} chứng từ bắt buộc)
                  </p>
                  <p className="mt-1 text-sm text-emerald-700">
                    Phiếu đáp ứng toàn bộ quy định kiểm toán của Phòng Cung Ứng và Phòng Kế Toán.
                  </p>
                </Notice>
              ) : (
                <Notice tone="danger">
                  <p className="font-semibold text-red-900">
                    Phát hiện thiếu {audit.missingDocuments.length} chứng từ bắt buộc!
                  </p>
                  <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
                    {audit.missingDocuments.map((m) => (
                      <li key={m.slot}>
                        <strong>{m.label}</strong> [{m.department}]: {m.description}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-red-700">
                    💡 Hãy gửi thông báo đôn đốc bộ phận phụ trách hoặc nếu là Admin, bạn có thể bấm <strong>"Trả về bộ phận làm thiếu"</strong> để đưa phiếu về đúng bước xử lý.
                  </p>
                </Notice>
              )}

              {/* Grouped attachment checklist */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-slate-800">Danh mục chứng từ theo quy trình:</h4>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {SLOT_GROUPS.map((grp) => {
                    const groupSlots = grp.slots.filter((s) => audit.requiredSlots.includes(s));
                    if (groupSlots.length === 0) return null;

                    return (
                      <div key={grp.step} className="p-3.5 bg-white">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-mono text-xs font-semibold text-slate-500">
                            {grp.step} · {grp.title}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {groupSlots.map((slot) => {
                            const isSlotAttached = audit.attachedSlots.includes(slot);
                            const files = attached.filter((a) => a.slot === slot);
                            const def = SLOT_DEF[slot];

                            return (
                              <div
                                key={slot}
                                className={cx(
                                  'flex items-start justify-between rounded-lg p-2.5 text-xs',
                                  isSlotAttached ? 'bg-emerald-50/50 border border-emerald-100' : 'bg-red-50/60 border border-red-200',
                                )}
                              >
                                <div>
                                  <div className="flex items-center gap-2">
                                    {isSlotAttached ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                                    ) : (
                                      <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                                    )}
                                    <span className="font-medium text-slate-900 text-sm">
                                      {def.label}
                                    </span>
                                    <span
                                      className={cx(
                                        'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                        def.owner === 'REQUESTER'
                                          ? 'bg-blue-100 text-blue-800'
                                          : 'bg-purple-100 text-purple-800',
                                      )}
                                    >
                                      {def.owner === 'REQUESTER' ? 'Phòng Cung Ứng' : 'Phòng Kế Toán'}
                                    </span>
                                  </div>

                                  {isSlotAttached ? (
                                    <div className="mt-1 pl-6 text-slate-600">
                                      {files.map((f) => (
                                        <div key={f.id} className="flex items-center gap-1.5">
                                          <FileText className="h-3 w-3 text-slate-400" />
                                          <span className="font-mono text-xs text-slate-800">{f.fileName}</span>
                                          <span className="text-[11px] text-slate-400">
                                            ({Math.round(f.size / 1024)} KB) · {userName(db, f.uploadedBy)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="mt-1 pl-6 text-xs text-red-700 font-medium">
                                      Chưa có file đính kèm! Bộ phận cần nộp: {def.owner === 'REQUESTER' ? `NV Cung ứng (${userName(db, inspectPr.assignedRequesterId)})` : `Kế toán (${userName(db, inspectPr.assignedAccountantId)})`}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* ------------------------------------------------------------------ */}
      {/* 2. Modal: Gửi thông báo cho bộ phận làm thiếu */}
      {/* ------------------------------------------------------------------ */}
      {notifyPr && (() => {
        const audit = checkCompletedAttachments(db, notifyPr);
        const departments: string[] = [];
        if (audit.hasProcurementMissing) departments.push('Phòng Cung Ứng');
        if (audit.hasAccountingMissing) departments.push('Phòng Kế Toán');

        return (
          <Modal
            title={`Gửi thông báo thiếu chứng từ — ${notifyPr.code}`}
            onClose={() => setNotifyPr(null)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setNotifyPr(null)}>
                  Hủy
                </Button>
                <Button
                  variant="primary"
                  onClick={async () => {
                    const ok = await attempt(() =>
                      store.run({
                        type: 'NOTIFY_MISSING_DOCS',
                        id: notifyPr.id,
                        note: notifyNote,
                      }),
                    );
                    if (ok) setNotifyPr(null);
                  }}
                >
                  <Bell className="h-4 w-4" /> Gửi thông báo & Ghi nhận trao đổi
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              <Notice tone="warn">
                Hệ thống sẽ gửi thông báo chuông (Notification) kèm nội dung đôn đốc trực tiếp trên trao đổi của phiếu đến:
                <br />
                <strong>{departments.join(' & ')}</strong> (Nhân sự phụ trách: {userName(db, notifyPr.assignedRequesterId)} / {userName(db, notifyPr.assignedAccountantId)}).
              </Notice>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 space-y-1">
                <p className="font-semibold text-slate-900">Danh sách chứng từ thiếu cần bổ sung:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {audit.missingDocuments.map((m) => (
                    <li key={m.slot}>
                      <strong>{m.label}</strong> ({m.department}): {m.description}
                    </li>
                  ))}
                </ul>
              </div>

              <Field label="Ghi chú đôn đốc bổ sung (tùy chọn)" htmlFor="notify-note">
                <Textarea
                  id="notify-note"
                  rows={3}
                  value={notifyNote}
                  onChange={(e) => setNotifyNote(e.target.value)}
                  placeholder="Ví dụ: Đề nghị cung cấp hóa đơn VAT trước ngày mai để hoàn tất quyết toán quý..."
                />
              </Field>
            </div>
          </Modal>
        );
      })()}

      {/* ------------------------------------------------------------------ */}
      {/* 3. Modal: Admin Trả về cho bộ phận làm thiếu */}
      {/* ------------------------------------------------------------------ */}
      {returnPr && (() => {
        const audit = checkCompletedAttachments(db, returnPr);

        return (
          <Modal
            title={`Thu hồi hoàn thành & Trả về bộ phận — ${returnPr.code}`}
            onClose={() => setReturnPr(null)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setReturnPr(null)}>
                  Hủy
                </Button>
                <Button
                  variant="primary"
                  onClick={async () => {
                    if (!returnReason.trim()) {
                      alert('Vui lòng nhập lý do trả về');
                      return;
                    }
                    const ok = await attempt(() =>
                      store.run({
                        type: 'FORCE',
                        id: returnPr.id,
                        version: returnPr.version,
                        toStatus: returnToStatus,
                        reason: returnReason,
                      }),
                    );
                    if (ok) setReturnPr(null);
                  }}
                >
                  <RotateCcw className="h-4 w-4" /> Xác nhận trả về
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              <Notice tone="warn">
                <p className="font-medium text-amber-900">
                  Phiếu sẽ được thu hồi khỏi trạng thái "Hoàn thành" và quay lại bước làm việc để bộ phận phụ trách nộp chứng từ.
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  Hệ thống sẽ mở khóa ô đính kèm tương ứng và thông báo cho nhân viên phụ trách. Thao tác này được ghi nhận trong lịch sử duyệt (Timeline) và nhật ký kiểm toán.
                </p>
              </Notice>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <span className="font-semibold text-slate-900">Chứng từ thiếu:</span>{' '}
                {audit.missingDocuments.map((m) => `${m.label} (${m.department})`).join(', ')}
              </div>

              <Field label="Chọn bước trả về" required htmlFor="return-to-status">
                <Select
                  id="return-to-status"
                  value={returnToStatus}
                  onChange={(e) => setReturnToStatus(e.target.value as Status)}
                >
                  <option value="DOCUMENT_SUPPLEMENT_REQUIRED">
                    B8 · Cần bổ sung hóa đơn (Phòng Cung Ứng bổ sung hóa đơn)
                  </option>
                  <option value="AFTER_ADVANCE">
                    B6 · Theo dõi sau tạm ứng (Phòng Cung Ứng nộp nghiệm thu & ĐNTT)
                  </option>
                  <option value="FINAL_PAYMENT">
                    B7 · PKT thanh toán (Phòng Kế Toán tải UNC đợt cuối / hoàn ứng)
                  </option>
                  <option value="ADVANCE_PAYMENT">
                    B5 · PKT tạm ứng (Phòng Kế Toán nộp UNC tạm ứng)
                  </option>
                  <option value="ADVANCE_PREPARATION">
                    B3 · Nộp hồ sơ tạm ứng (Phòng Cung Ứng nộp PO / đề nghị TƯ)
                  </option>
                  <option value="DRAFT">
                    B1.1 · Tạo phiếu mới (Phòng Cung Ứng làm lại hồ sơ gốc)
                  </option>
                </Select>
              </Field>

              <Field label="Lý do trả về (bắt buộc)" required htmlFor="return-reason">
                <Textarea
                  id="return-reason"
                  rows={3}
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="Nhập lý do chi tiết để bộ phận liên quan nắm rõ..."
                />
              </Field>
            </div>
          </Modal>
        );
      })()}

      {/* ------------------------------------------------------------------ */}
      {/* 4. Modal: Admin Xóa phiếu hoàn thành thiếu chứng từ */}
      {/* ------------------------------------------------------------------ */}
      {deletePr && (
        <Modal
          title={`Xác nhận xóa phiếu hoàn thành — ${deletePr.code}`}
          onClose={() => setDeletePr(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeletePr(null)}>
                Hủy
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  if (!deleteReason.trim()) {
                    alert('Vui lòng nhập lý do xóa phiếu');
                    return;
                  }
                  const ok = await attempt(() =>
                    store.run({
                      type: 'DELETE_REQUEST',
                      id: deletePr.id,
                      version: deletePr.version,
                      reason: deleteReason,
                    }),
                  );
                  if (ok) setDeletePr(null);
                }}
              >
                <Trash2 className="h-4 w-4" /> Xóa vĩnh viễn phiếu
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Notice tone="danger">
              <p className="font-semibold text-red-900">Hành động này không thể hoàn tác!</p>
              <p className="mt-1 text-sm text-red-800">
                Phiếu <strong>{deletePr.code}</strong> (đang thiếu chứng từ) cùng toàn bộ tệp đính kèm và trao đổi liên quan sẽ bị xóa hoàn toàn khỏi hệ thống.
              </p>
            </Notice>

            <Field label="Lý do xóa phiếu (bắt buộc)" required htmlFor="del-reason">
              <Textarea
                id="del-reason"
                rows={3}
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Nhập lý do xóa phiếu hoàn thành này..."
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 5. Modal: Admin lưu trữ tệp đính kèm sang NAS (A5) */}
      {/* ------------------------------------------------------------------ */}
      {archivePr && (
        <Modal
          title={`Lưu trữ tệp đính kèm — ${archivePr.code}`}
          onClose={() => setArchivePr(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setArchivePr(null)}>
                Hủy
              </Button>
              <Button
                onClick={async () => {
                  const ok = await attempt(() =>
                    store.run({ type: 'ARCHIVE', id: archivePr.id, version: archivePr.version }),
                  );
                  if (ok) setArchivePr(null);
                }}
              >
                <Archive className="h-4 w-4" /> Chuyển sang NAS và dọn đĩa
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Notice tone="info">
              <p className="font-semibold text-slate-900">Hồ sơ được giữ nguyên, chỉ tệp rời khỏi máy chủ.</p>
              <p className="mt-1 text-sm text-slate-700">
                Phiếu vẫn tra cứu được đầy đủ: số tiền, nhà cung cấp, dự án và toàn bộ lịch sử duyệt. Danh sách tệp
                cũng còn nguyên, chỉ là tệp nằm trên NAS thay vì trên đĩa máy chủ.
              </p>
            </Notice>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">Trình tự thực hiện</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
                <li>Chép từng tệp sang NAS rồi đối chiếu đúng kích thước</li>
                <li>Chỉ khi khớp mới xóa bản trên đĩa máy chủ</li>
                <li>Đánh dấu phiếu đã lưu trữ</li>
              </ol>
              <p className="mt-2 text-xs text-slate-600">
                NAS chưa gắn hoặc chép không khớp thì dừng lại và không xóa gì cả.
              </p>
            </div>

            <p className="text-sm text-slate-600">
              Đảo lại bất cứ lúc nào bằng nút <span className="font-medium">Phục hồi</span> trên cùng dòng.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
