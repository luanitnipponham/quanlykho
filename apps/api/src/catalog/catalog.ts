// Danh mục, phòng ban, người dùng, cấu hình, ngày lễ, nhật ký, thông báo, báo cáo (workflow §8, §9, §11).
import { Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import * as argon2 from 'argon2';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, Roles } from '../common/common';
import { ROLE_DEPT_KIND, deny, fail, type Actor, type Role } from '../common/domain';

const MASTER = ['projects', 'categories', 'requesterNames', 'vendors', 'accountantNames'] as const;
type MasterKind = (typeof MASTER)[number];

const MASTER_LABEL: Record<MasterKind, string> = {
  projects: 'Dự án',
  categories: 'Hạng mục chi',
  requesterNames: 'Người yêu cầu',
  vendors: 'Nhà cung cấp',
  accountantNames: 'Nhân viên kế toán',
};

const MASTER_FK: Record<MasterKind, 'projectId' | 'categoryId' | 'requesterNameId' | 'vendorId' | 'accountantNameId'> = {
  projects: 'projectId',
  categories: 'categoryId',
  requesterNames: 'requesterNameId',
  vendors: 'vendorId',
  accountantNames: 'accountantNameId',
};

/** Tiền tố mã tự sinh cho từng danh mục; người dùng chỉ nhập tên. */
const MASTER_PREFIX: Record<MasterKind, string> = {
  projects: 'DA',
  categories: 'HM',
  requesterNames: 'NYC',
  vendors: 'NCC',
  accountantNames: 'KT',
};

export class MasterDto {
  @IsOptional() @IsString() code?: string;
  @IsString() name: string;
}

export class UserDto {
  @IsString() username: string;
  @IsString() fullName: string;
  @IsIn(['REQUESTER', 'LEADER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'ADMIN']) role: Role;
  @IsOptional() @IsString() password?: string;
}

export class DepartmentDto {
  @IsString() code: string;
  @IsString() name: string;
}

export class HolidayDto {
  @IsString() date: string;
  @IsString() name: string;
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** URL uses the plural kind; the Prisma model accessor is singular. */
  private model(kind: MasterKind) {
    if (!MASTER.includes(kind)) fail('ERR_NOT_FOUND', 'Danh mục không hợp lệ');
    const modelOf: Record<MasterKind, 'project' | 'category' | 'requesterName' | 'vendor' | 'accountantName'> = {
      projects: 'project',
      categories: 'category',
      requesterNames: 'requesterName',
      vendors: 'vendor',
      accountantNames: 'accountantName',
    };
    return this.prisma[modelOf[kind]] as never as {
      findMany: (a?: unknown) => Promise<{ id: string; code: string; name: string; deleted: boolean }[]>;
      create: (a: unknown) => Promise<{ id: string; name: string }>;
      update: (a: unknown) => Promise<{ id: string; name: string }>;
      findUnique: (a: unknown) => Promise<{ id: string; name: string; deleted: boolean } | null>;
    };
  }

  listMaster(kind: MasterKind) {
    return this.model(kind).findMany({ where: { deleted: false }, orderBy: { name: 'asc' } });
  }

  /**
   * Danh mục nghiệp vụ do NV Cung ứng và Admin giữ (workflow §8.1).
   * Riêng danh sách nhân viên Kế toán do TPTC giữ, vì chính TPTC chỉ định người nhận phiếu ở B4.
   */
  private assertMasterWriter(actor: Actor, kind: MasterKind) {
    if (kind === 'accountantNames') {
      if (actor.role !== 'FINANCE_MANAGER' && actor.role !== 'ADMIN') deny('Chỉ Trưởng phòng Tài chính và Admin sửa được danh mục này');
      return;
    }
    if (actor.role !== 'REQUESTER' && actor.role !== 'ADMIN') deny('Bạn chỉ được xem danh mục này');
  }

  async saveMaster(actor: Actor, kind: MasterKind, id: string | null, dto: MasterDto) {
    this.assertMasterWriter(actor, kind);
    const name = dto.name.trim();
    if (!name) fail('ERR_REQUIRED_FIELD', 'Nhập tên');
    const dup = await this.model(kind).findMany({ where: { deleted: false, name: { equals: name, mode: 'insensitive' }, NOT: id ? { id } : undefined } });
    if (dup.length) fail('ERR_REQUIRED_FIELD', `"${name}" đã có trong danh mục`);
    // Mã do hệ thống sinh: người dùng chỉ nhập tên. Sửa tên không đổi mã, vì mã đã
    // xuất hiện trên phiếu và báo cáo cũ.
    const row = id
      ? await this.model(kind).update({ where: { id }, data: { name } })
      : await this.model(kind).create({ data: { name, code: await this.nextMasterCode(kind) } });
    await this.audit(actor.id, 'MASTER_SAVE', kind, row.id, `${MASTER_LABEL[kind]}: ${name}`);
    return { message: 'Đã lưu danh mục' };
  }

  /**
   * Mã kế tiếp theo dạng DA-001. Tính cả mục đã xóa mềm để mã không bị dùng lại —
   * mã cũ vẫn nằm trên phiếu và báo cáo đã in.
   */
  private async nextMasterCode(kind: MasterKind): Promise<string> {
    const prefix = MASTER_PREFIX[kind];
    const rows = await this.model(kind).findMany({});
    const used = new Set(rows.map((r) => r.code));
    let max = 0;
    for (const r of rows) {
      const m = /^([A-Za-z]+)-(d+)$/.exec(r.code ?? '');
      if (m && m[1].toUpperCase() === prefix) max = Math.max(max, Number(m[2]));
    }
    let next = max + 1;
    // Dữ liệu cũ có thể mang mã gõ tay trùng dạng; nhảy qua cho tới khi còn trống.
    while (used.has(`${prefix}-${String(next).padStart(3, '0')}`)) next += 1;
    return `${prefix}-${String(next).padStart(3, '0')}`;
  }

  async deleteMaster(actor: Actor, kind: MasterKind, id: string) {
    this.assertMasterWriter(actor, kind);
    const item = await this.model(kind).findUnique({ where: { id } });
    if (!item || item.deleted) fail('ERR_NOT_FOUND', 'Không tìm thấy mục');
    const used = await this.prisma.paymentRequest.count({
      where: { [MASTER_FK[kind]]: id, status: { notIn: ['COMPLETED', 'CANCELLED', 'REJECTED'] } } as never,
    });
    if (used > 0) fail('ERR_MASTER_DATA_IN_USE', `"${item.name}" đang gắn với ${used} phiếu chưa kết thúc`);
    await this.model(kind).update({ where: { id }, data: { deleted: true } });
    await this.audit(actor.id, 'MASTER_DELETE', kind, id, `${MASTER_LABEL[kind]}: xóa mềm ${item.name}`);
    return { message: 'Đã xóa (xóa mềm)' };
  }

  // ----- Departments: exactly four rows, rename only (workflow §2b) --------

  listDepartments() {
    return this.prisma.department.findMany({
      orderBy: { code: 'asc' },
      include: { users: { where: { status: 'ACTIVE' }, select: { id: true, fullName: true, username: true, role: true } } },
    });
  }

  async renameDepartment(actor: Actor, id: string, dto: DepartmentDto) {
    const name = dto.name.trim();
    if (!name || !dto.code.trim()) fail('ERR_REQUIRED_FIELD', 'Nhập mã và tên phòng ban');
    const d = await this.prisma.department.findUnique({ where: { id } });
    if (!d) fail('ERR_NOT_FOUND', 'Không tìm thấy phòng ban');
    await this.prisma.department.update({ where: { id }, data: { code: dto.code.trim(), name } });
    await this.audit(actor.id, 'DEPARTMENT_SAVE', 'department', id, `Phòng ban: ${name}`);
    return { message: 'Đã lưu phòng ban' };
  }

  // ----- Users (workflow §11.2) -------------------------------------------

  listUsers() {
    return this.prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        departmentId: true,
        status: true,
        mustChangePassword: true,
        lockedUntil: true,
        department: { select: { name: true } },
      },
    });
  }

  private async departmentIdFor(role: Role): Promise<string | null> {
    const kind = ROLE_DEPT_KIND[role];
    if (!kind) return null;
    const d = await this.prisma.department.findUnique({ where: { kind } });
    return d?.id ?? null;
  }

  /** Each of the four departments holds exactly one active account. */
  private async assertSeatFree(role: Role, exceptUserId?: string) {
    if (role === 'ADMIN') return;
    const holder = await this.prisma.user.findFirst({
      where: { role, status: 'ACTIVE', NOT: exceptUserId ? { id: exceptUserId } : undefined },
    });
    if (holder) fail('ERR_DEPARTMENT_OCCUPIED', `Phòng ban này đã có tài khoản ${role} đang hoạt động (${holder.username})`);
  }

  private validatePassword(pw: string) {
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
      fail('ERR_WEAK_PASSWORD', 'Mật khẩu tối thiểu 8 ký tự, gồm cả chữ và số');
    }
  }

  async createUser(actor: Actor, dto: UserDto) {
    const username = dto.username.trim();
    if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
      fail('ERR_REQUIRED_FIELD', 'Username 3–50 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch dưới, gạch ngang');
    }
    if (!dto.fullName.trim()) fail('ERR_REQUIRED_FIELD', 'Nhập họ tên');
    const exists = await this.prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } });
    if (exists) fail('ERR_DUPLICATE_USERNAME', `Username "${username}" đã tồn tại`);
    await this.assertSeatFree(dto.role);
    const password = dto.password ?? '';
    this.validatePassword(password);

    const user = await this.prisma.user.create({
      data: {
        username,
        fullName: dto.fullName.trim(),
        role: dto.role,
        departmentId: await this.departmentIdFor(dto.role),
        passwordHash: await argon2.hash(password),
        mustChangePassword: true,
        createdById: actor.id,
      },
    });
    await this.audit(actor.id, 'USER_CREATE', 'user', user.id, `Tạo tài khoản ${user.username} (${user.role})`);
    return { message: `Đã tạo tài khoản ${user.username}` };
  }

  async updateUser(actor: Actor, id: string, dto: UserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) fail('ERR_NOT_FOUND', 'Không tìm thấy tài khoản');
    const username = dto.username.trim();
    const dup = await this.prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' }, NOT: { id } } });
    if (dup) fail('ERR_DUPLICATE_USERNAME', `Username "${username}" đã tồn tại`);
    if (dto.role !== user.role) await this.assertSeatFree(dto.role, id);
    await this.prisma.user.update({
      where: { id },
      data: { username, fullName: dto.fullName.trim(), role: dto.role, departmentId: await this.departmentIdFor(dto.role) },
    });
    await this.audit(actor.id, 'USER_UPDATE', 'user', id, `Sửa tài khoản ${username}`);
    return { message: 'Đã lưu tài khoản' };
  }

  async setUserStatus(actor: Actor, id: string, status: 'ACTIVE' | 'LOCKED') {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) fail('ERR_NOT_FOUND', 'Không tìm thấy tài khoản');
    if (status === 'LOCKED' && user.role === 'ADMIN') {
      const others = await this.prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', NOT: { id } } });
      if (others === 0) fail('ERR_LAST_ADMIN', 'Hệ thống phải còn ít nhất 1 Admin đang hoạt động');
    }
    if (status === 'ACTIVE') await this.assertSeatFree(user.role as Role, id);
    await this.prisma.user.update({
      where: { id },
      data: { status, ...(status === 'ACTIVE' ? { failedLoginCount: 0, lockedUntil: null } : {}) },
    });
    // Locking a user kills their open session (workflow §11.1).
    if (status === 'LOCKED') await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit(actor.id, status === 'LOCKED' ? 'USER_LOCK' : 'USER_UNLOCK', 'user', id, `${status === 'LOCKED' ? 'Khóa' : 'Mở khóa'} ${user.username}`);
    return { message: status === 'LOCKED' ? 'Đã khóa tài khoản (phiên đang mở bị vô hiệu)' : 'Đã mở khóa tài khoản' };
  }

  async resetPassword(actor: Actor, id: string, password: string) {
    this.validatePassword(password ?? '');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) fail('ERR_NOT_FOUND', 'Không tìm thấy tài khoản');
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await argon2.hash(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
    });
    await this.audit(actor.id, 'USER_RESET_PASSWORD', 'user', id, `Đặt lại mật khẩu ${user.username}`);
    return { message: 'Đã đặt lại mật khẩu; người dùng phải đổi ở lần đăng nhập tới' };
  }

  async deleteUser(actor: Actor, id: string) {
    if (id === actor.id) fail('ERR_CANNOT_DELETE_SELF', 'Không thể xóa tài khoản đang đăng nhập');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) fail('ERR_NOT_FOUND', 'Không tìm thấy tài khoản');
    const linked = await this.prisma.paymentRequest.count({
      where: { OR: [{ createdById: id }, { assignedRequesterId: id }, { assignedAccountantId: id }] },
    });
    if (linked > 0) fail('ERR_USER_IN_USE', `Tài khoản đang gắn với ${linked} phiếu. Hãy khóa tài khoản thay vì xóa.`);
    await this.prisma.user.delete({ where: { id } });
    await this.audit(actor.id, 'USER_DELETE', 'user', id, `Xóa tài khoản ${user.username}`);
    return { message: `Đã xóa tài khoản ${user.username}` };
  }

  // ----- Config, holidays, audit, notifications, reports -------------------

  async config() {
    return (
      (await this.prisma.systemConfig.findUnique({ where: { key: 'SYSTEM' } })) ??
      this.prisma.systemConfig.create({ data: { key: 'SYSTEM', allowedExtensions: [] } })
    );
  }

  async saveConfig(actor: Actor, dto: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    for (const k of ['invoiceDeadlineWorkingDays', 'maxLoginAttempts', 'lockMinutes', 'maxFileSizeMb', 'auditRetentionDays']) {
      const v = Number(dto[k]);
      if (!Number.isInteger(v) || v < 1) fail('ERR_REQUIRED_FIELD', `${k} phải là số nguyên ≥ 1`);
      data[k] = v;
    }
    const ext = dto.allowedExtensions as string[] | undefined;
    if (!ext?.length) fail('ERR_REQUIRED_FIELD', 'Phải cho phép ít nhất 1 định dạng file');
    data.allowedExtensions = [...new Set(ext.map((e) => e.toLowerCase()))];
    await this.prisma.systemConfig.upsert({ where: { key: 'SYSTEM' }, create: { key: 'SYSTEM', ...data } as never, update: data as never });
    await this.audit(actor.id, 'CONFIG_SAVE', 'config', null, 'Cập nhật cấu hình hệ thống');
    return { message: 'Đã lưu cấu hình' };
  }

  listHolidays() {
    return this.prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  }

  async saveHoliday(actor: Actor, dto: HolidayDto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.date) || !dto.name.trim()) fail('ERR_REQUIRED_FIELD', 'Nhập ngày và tên ngày lễ');
    await this.prisma.holiday.upsert({ where: { date: dto.date }, create: { date: dto.date, name: dto.name.trim() }, update: { name: dto.name.trim() } });
    await this.audit(actor.id, 'HOLIDAY_SAVE', 'holiday', dto.date, `Ngày lễ ${dto.date}: ${dto.name}`);
    return { message: 'Đã lưu ngày lễ' };
  }

  async deleteHoliday(actor: Actor, date: string) {
    await this.prisma.holiday.deleteMany({ where: { date } });
    await this.audit(actor.id, 'HOLIDAY_DELETE', 'holiday', date, `Xóa ngày lễ ${date}`);
    return { message: 'Đã xóa ngày lễ' };
  }

  /** Mỗi người xem nhật ký của mình; Admin xem toàn hệ thống (workflow §8.4). */
  audits(actor: Actor) {
    return this.prisma.auditLog.findMany({
      where: actor.role === 'ADMIN' ? {} : { actorId: actor.id },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { actor: { select: { id: true, fullName: true } } },
    });
  }

  notifications(actor: Actor) {
    return this.prisma.notification.findMany({ where: { userId: actor.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async markRead(actor: Actor, ids: string[] | 'ALL') {
    await this.prisma.notification.updateMany({
      where: { userId: actor.id, ...(ids === 'ALL' ? {} : { id: { in: ids } }) },
      data: { read: true },
    });
    return {};
  }

  async report() {
    const [byStatus, byProject, totals] = await Promise.all([
      this.prisma.paymentRequest.groupBy({ by: ['status'], _count: true, _sum: { requestedAmount: true } }),
      this.prisma.paymentRequest.groupBy({ by: ['projectId'], _count: true, _sum: { requestedAmount: true } }),
      this.prisma.paymentTransaction.aggregate({ _sum: { amount: true } }),
    ]);
    const projects = await this.prisma.project.findMany({ select: { id: true, name: true } });
    return {
      byStatus,
      byProject: byProject.map((p) => ({ ...p, name: projects.find((x) => x.id === p.projectId)?.name ?? '—' })),
      totalPaid: totals._sum.amount ?? 0,
    };
  }

  private audit(actorId: string | null, action: string, entity: string, entityId: string | null, detail: string) {
    return this.prisma.auditLog.create({ data: { actorId, action, entity, entityId, detail } });
  }
}

@Controller()
export class CatalogController {
  constructor(private readonly svc: CatalogService) {}

  @Get('master-data/:kind')
  listMaster(@Param('kind') kind: MasterKind) {
    return this.svc.listMaster(kind);
  }

  @Post('master-data/:kind')
  createMaster(@CurrentUser() actor: Actor, @Param('kind') kind: MasterKind, @Body() dto: MasterDto) {
    return this.svc.saveMaster(actor, kind, null, dto);
  }

  @Patch('master-data/:kind/:id')
  updateMaster(@CurrentUser() actor: Actor, @Param('kind') kind: MasterKind, @Param('id') id: string, @Body() dto: MasterDto) {
    return this.svc.saveMaster(actor, kind, id, dto);
  }

  @Delete('master-data/:kind/:id')
  deleteMaster(@CurrentUser() actor: Actor, @Param('kind') kind: MasterKind, @Param('id') id: string) {
    return this.svc.deleteMaster(actor, kind, id);
  }

  @Get('departments')
  departments() {
    return this.svc.listDepartments();
  }

  @Patch('departments/:id')
  @Roles('ADMIN')
  renameDepartment(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: DepartmentDto) {
    return this.svc.renameDepartment(actor, id, dto);
  }

  @Get('users')
  users() {
    return this.svc.listUsers();
  }

  @Post('users')
  @Roles('ADMIN')
  createUser(@CurrentUser() actor: Actor, @Body() dto: UserDto) {
    return this.svc.createUser(actor, dto);
  }

  @Patch('users/:id')
  @Roles('ADMIN')
  updateUser(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: UserDto) {
    return this.svc.updateUser(actor, id, dto);
  }

  @Post('users/:id/status')
  @Roles('ADMIN')
  setStatus(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() body: { status: 'ACTIVE' | 'LOCKED' }) {
    return this.svc.setUserStatus(actor, id, body.status);
  }

  @Post('users/:id/reset-password')
  @Roles('ADMIN')
  resetPassword(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() body: { password: string }) {
    return this.svc.resetPassword(actor, id, body.password);
  }

  @Delete('users/:id')
  @Roles('ADMIN')
  deleteUser(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.svc.deleteUser(actor, id);
  }

  @Get('config')
  getConfig() {
    return this.svc.config();
  }

  @Patch('config')
  @Roles('ADMIN')
  saveConfig(@CurrentUser() actor: Actor, @Body() dto: Record<string, unknown>) {
    return this.svc.saveConfig(actor, dto);
  }

  @Get('holidays')
  holidays() {
    return this.svc.listHolidays();
  }

  @Post('holidays')
  @Roles('ADMIN')
  saveHoliday(@CurrentUser() actor: Actor, @Body() dto: HolidayDto) {
    return this.svc.saveHoliday(actor, dto);
  }

  @Delete('holidays/:date')
  @Roles('ADMIN')
  deleteHoliday(@CurrentUser() actor: Actor, @Param('date') date: string) {
    return this.svc.deleteHoliday(actor, date);
  }

  @Get('history')
  history(@CurrentUser() actor: Actor) {
    return this.svc.audits(actor);
  }

  @Get('notifications')
  notifications(@CurrentUser() actor: Actor) {
    return this.svc.notifications(actor);
  }

  @Post('notifications/read')
  markRead(@CurrentUser() actor: Actor, @Body() body: { ids: string[] | 'ALL' }) {
    return this.svc.markRead(actor, body.ids);
  }

  @Get('reports/summary')
  @Roles('LEADER', 'FINANCE_MANAGER', 'ADMIN')
  report(@Query('scope') _scope?: string) {
    return this.svc.report();
  }
}

@Module({ controllers: [CatalogController], providers: [CatalogService, PrismaService], exports: [CatalogService] })
export class CatalogModule {}
