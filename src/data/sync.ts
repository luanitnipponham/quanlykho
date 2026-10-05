// Maps the backend payload onto the in-memory Db shape the screens already read.
import { DEFAULT_ALLOWED_EXTENSIONS } from '../domain/constants';
import { SCHEMA_VERSION } from '../domain/seed';
import type {
  Attachment,
  AuditEntry,
  Comment,
  Db,
  Department,
  MasterItem,
  Notification,
  PaymentRequest,
  User,
} from '../domain/types';
import { api } from './api';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nullableNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => (v ? new Date(v as string).toISOString() : new Date().toISOString());

type Row = Record<string, unknown>;

function mapUser(u: Row): User {
  return {
    id: u.id as string,
    username: u.username as string,
    fullName: u.fullName as string,
    passwordHash: '',
    mustChangePassword: Boolean(u.mustChangePassword),
    role: u.role as User['role'],
    departmentId: (u.departmentId as string) ?? null,
    status: u.status as User['status'],
    failedLoginCount: 0,
    lockedUntil: (u.lockedUntil as string) ?? null,
    createdAt: iso(u.createdAt),
  };
}

function mapMaster(m: Row): MasterItem {
  return { id: m.id as string, code: (m.code as string) ?? '', name: m.name as string, deleted: Boolean(m.deleted) };
}

function mapRequest(r: Row): PaymentRequest {
  return {
    id: r.id as string,
    code: r.code as string,
    status: r.status as PaymentRequest['status'],
    version: num(r.version),
    createdBy: r.createdById as string,
    createdByRole: r.createdByRole as PaymentRequest['createdByRole'],
    assignedRequesterId: r.assignedRequesterId as string,
    assignedAccountantId: (r.assignedAccountantId as string) ?? null,
    projectId: r.projectId as string,
    categoryId: r.categoryId as string,
    requesterNameId: r.requesterNameId as string,
    accountantNameId: (r.accountantNameId as string) ?? null,
    vendorId: r.vendorId as string,
    title: r.title as string,
    note: (r.note as string) ?? '',
    hasInvoice: Boolean(r.hasInvoice),
    requestedAmount: num(r.requestedAmount),
    advanceAmount: nullableNum(r.advanceAmount),
    settlementAmount: nullableNum(r.settlementAmount),
    priority: (r.priority as PaymentRequest['priority']) ?? null,
    invoiceDueStartAt: (r.invoiceDueStartAt as string) ?? null,
    lateInvoice: Boolean(r.lateInvoice),
    lastLateReminderOn: (r.lastLateReminderOn as string) ?? null,
    resubmitted: Boolean(r.resubmitted),
    transactions: ((r.transactions as Row[]) ?? []).map((t) => ({
      id: t.id as string,
      kind: t.kind as 'ADVANCE' | 'FINAL',
      amount: num(t.amount),
      method: t.method as PaymentRequest['transactions'][number]['method'],
      paidDate: t.paidDate as string,
      createdBy: t.createdById as string,
      createdAt: iso(t.createdAt),
    })),
    timeline: ((r.timeline as Row[]) ?? []).map((t) => ({
      id: t.id as string,
      action: t.action as PaymentRequest['timeline'][number]['action'],
      fromStatus: (t.fromStatus as PaymentRequest['status']) ?? null,
      toStatus: (t.toStatus as PaymentRequest['status']) ?? null,
      actorId: (t.actorId as string) ?? null,
      reason: (t.reason as string) ?? null,
      createdAt: iso(t.createdAt),
    })),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    completedAt: (r.completedAt as string) ?? null,
    archivedAt: (r.archivedAt as string) ?? null,
  };
}

function mapAttachment(a: Row): Attachment {
  return {
    id: a.id as string,
    requestId: a.requestId as string,
    slot: a.slot as Attachment['slot'],
    stage: a.stage as Attachment['stage'],
    folder: a.folder as Attachment['folder'],
    fileName: a.fileName as string,
    storagePath: a.storagePath as string,
    size: num(a.size),
    mimeType: (a.mimeType as string) ?? 'application/octet-stream',
    uploadedBy: a.uploadedById as string,
    uploadedAt: iso(a.uploadedAt),
  };
}

/** Pulls the whole working set in five parallel calls. */
export async function fetchDb(): Promise<Db> {
  const [departments, users, projects, categories, requesterNames, vendors, accountantNames, requests, notifications, audit, holidays, config] =
    await Promise.all([
      api.departments() as Promise<Row[]>,
      api.users() as Promise<Row[]>,
      api.master('projects') as Promise<Row[]>,
      api.master('categories') as Promise<Row[]>,
      api.master('requesterNames') as Promise<Row[]>,
      api.master('vendors') as Promise<Row[]>,
      api.master('accountantNames') as Promise<Row[]>,
      api.snapshot() as Promise<Row[]>,
      api.notifications() as Promise<Row[]>,
      api.history() as Promise<Row[]>,
      api.holidays(),
      api.config(),
    ]);

  const attachments: Attachment[] = [];
  const comments: Comment[] = [];
  for (const r of requests) {
    for (const a of (r.attachments as Row[]) ?? []) attachments.push(mapAttachment(a));
    for (const c of (r.comments as Row[]) ?? []) {
      comments.push({
        id: c.id as string,
        requestId: r.id as string,
        authorId: c.authorId as string,
        content: c.content as string,
        mentions: ((c.mentions as Row[]) ?? []).map((m) => (m.user as Row)?.id as string).filter(Boolean),
        createdAt: iso(c.createdAt),
      });
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    users: users.map(mapUser),
    departments: departments.map(
      (d): Department => ({ id: d.id as string, code: d.code as string, name: d.name as string, kind: d.kind as Department['kind'] }),
    ),
    projects: projects.map(mapMaster),
    categories: categories.map(mapMaster),
    requesterNames: requesterNames.map(mapMaster),
    accountantNames: accountantNames.map(mapMaster),
    vendors: vendors.map(mapMaster),
    requests: requests.map(mapRequest),
    attachments,
    comments,
    notifications: notifications.map(
      (n): Notification => ({
        id: n.id as string,
        userId: n.userId as string,
        requestId: (n.requestId as string) ?? null,
        title: n.title as string,
        message: n.message as string,
        read: Boolean(n.read),
        createdAt: iso(n.createdAt),
      }),
    ),
    audit: audit.map(
      (a): AuditEntry => ({
        id: a.id as string,
        actorId: (a.actorId as string) ?? null,
        action: a.action as string,
        entity: a.entity as string,
        entityId: (a.entityId as string) ?? null,
        detail: a.detail as string,
        createdAt: iso(a.createdAt),
      }),
    ),
    holidays,
    config: {
      invoiceDeadlineWorkingDays: num(config.invoiceDeadlineWorkingDays) || 5,
      maxLoginAttempts: num(config.maxLoginAttempts) || 5,
      lockMinutes: num(config.lockMinutes) || 15,
      maxFileSizeMb: num(config.maxFileSizeMb) || 25,
      auditRetentionDays: num(config.auditRetentionDays) || 6,
      allowedExtensions: (config.allowedExtensions as string[]) ?? [...DEFAULT_ALLOWED_EXTENSIONS],
    },
    seq: {},
    idCounter: 0,
  };
}
