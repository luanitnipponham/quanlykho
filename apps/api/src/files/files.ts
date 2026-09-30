// Tệp đính kèm: lưu theo /CHUNG_TU/{CUNG_UNG|KE_TOAN}/{YYYY-MM-DD}/{MA_PHIEU}/ (workflow §8.2, §8.3).
import {
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../common/common';
import {
  SLOT_DEF,
  STORAGE_ROOT,
  buildFileName,
  canUploadToSlot,
  fail,
  storagePathOf,
  toDateKey,
  type Actor,
  type Slot,
} from '../common/domain';

/** Absolute root of the document tree; override with STORAGE_DIR. */
export const STORAGE_DIR = process.env.STORAGE_DIR || path.resolve(process.cwd(), 'storage');

/** Xóa thư mục nếu đã rỗng; không bao giờ đi lên quá gốc CHUNG_TU. */
function pruneIfEmpty(dir: string): void {
  const root = path.join(STORAGE_DIR, STORAGE_ROOT);
  if (dir === root || !dir.startsWith(root + path.sep)) return;
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // Thư mục đang bận hoặc đã biến mất — không đáng để làm hỏng thao tác xóa phiếu.
  }
}

// ---------------------------------------------------------------------------
// Kho lưu trữ trên NAS (A5)
// ---------------------------------------------------------------------------

/** Gốc kho lưu trữ, gắn vào container qua biến ARCHIVE_DIR. Rỗng nghĩa là tắt tính năng. */
export const ARCHIVE_DIR = process.env.ARCHIVE_DIR || '';

/**
 * Tệp mốc nằm sẵn trên NAS. Không có nó thì coi như NAS chưa được gắn.
 *
 * Nếu NAS rớt, điểm gắn trở thành thư mục rỗng trên đĩa máy chủ. Thiếu kiểm tra này,
 * "lưu trữ" sẽ chép file sang chính máy chủ rồi xóa bản gốc — mất sạch mà vẫn báo thành công.
 */
const ARCHIVE_MARKER = '.quanlykho-archive';

export function archiveAvailable(): boolean {
  return !!ARCHIVE_DIR && fs.existsSync(path.join(ARCHIVE_DIR, ARCHIVE_MARKER));
}

function assertArchiveReady(): void {
  if (!ARCHIVE_DIR) {
    fail('ERR_ARCHIVE_NOT_CONFIGURED', 'Chưa cấu hình kho lưu trữ. Đặt ARCHIVE_DIR và gắn NAS vào container.');
  }
  if (!fs.existsSync(path.join(ARCHIVE_DIR, ARCHIVE_MARKER))) {
    fail(
      'ERR_ARCHIVE_UNAVAILABLE',
      `Không thấy dấu hiệu kho lưu trữ tại ${ARCHIVE_DIR}. NAS có thể chưa được gắn — kiểm tra trước khi thử lại.`,
    );
  }
}

/**
 * Đẩy file đính kèm sang NAS rồi xóa khỏi đĩa máy chủ. Hàng trong CSDL giữ nguyên
 * nên phiếu vẫn tra cứu được và biết chính xác từng file đã nằm ở đâu.
 *
 * Chỉ xóa bản trên máy chủ sau khi đã đối chiếu bản trên NAS đúng kích thước.
 */
export function archiveStoredFiles(storagePaths: string[]): { moved: number; bytes: number; missing: string[] } {
  assertArchiveReady();
  const dirs = new Set<string>();
  const missing: string[] = [];
  let moved = 0;
  let bytes = 0;

  for (const p of storagePaths) {
    const rel = p.replace(/^\//, '');
    const local = path.join(STORAGE_DIR, rel);
    const remote = path.join(ARCHIVE_DIR, rel);

    if (!fs.existsSync(local)) {
      // Đã lưu trữ từ trước thì bỏ qua; mất cả hai bên thì phải nói ra.
      if (!fs.existsSync(remote)) missing.push(p);
      continue;
    }

    const size = fs.statSync(local).size;
    if (!fs.existsSync(remote) || fs.statSync(remote).size !== size) {
      fs.mkdirSync(path.dirname(remote), { recursive: true });
      fs.copyFileSync(local, remote);
    }
    if (!fs.existsSync(remote) || fs.statSync(remote).size !== size) {
      fail('ERR_ARCHIVE_COPY_FAILED', `Chép lên NAS không khớp kích thước: ${p}. Đã dừng, chưa xóa gì.`);
    }

    fs.rmSync(local, { force: true });
    dirs.add(path.dirname(local));
    moved += 1;
    bytes += size;
  }

  for (const dir of dirs) {
    pruneIfEmpty(dir);
    pruneIfEmpty(path.dirname(dir));
  }
  return { moved, bytes, missing };
}

/** Kéo file từ NAS về lại đĩa máy chủ, đúng đường dẫn cũ ghi trong CSDL. */
export function restoreStoredFiles(storagePaths: string[]): { restored: number; missing: string[] } {
  assertArchiveReady();
  const missing: string[] = [];

  // Kiểm tra đủ bộ trước khi chép: phục hồi được một nửa còn khó xử hơn là không phục hồi.
  for (const p of storagePaths) {
    const rel = p.replace(/^\//, '');
    if (!fs.existsSync(path.join(STORAGE_DIR, rel)) && !fs.existsSync(path.join(ARCHIVE_DIR, rel))) missing.push(p);
  }
  if (missing.length) {
    fail('ERR_ARCHIVE_INCOMPLETE', `Thiếu ${missing.length} file trên NAS, ví dụ: ${missing[0]}. Chưa phục hồi gì.`);
  }

  let restored = 0;
  for (const p of storagePaths) {
    const rel = p.replace(/^\//, '');
    const local = path.join(STORAGE_DIR, rel);
    if (fs.existsSync(local)) continue;
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.copyFileSync(path.join(ARCHIVE_DIR, rel), local);
    restored += 1;
  }
  return { restored, missing };
}

/**
 * Xóa file vật lý của các đính kèm rồi dọn thư mục mã phiếu và thư mục ngày nếu rỗng.
 * Xóa phiếu chỉ xóa hàng trong CSDL (cascade), nên nếu không gọi hàm này thì file
 * ở lại trong CHUNG_TU mãi mãi mà không còn gì trỏ tới.
 */
export function removeStoredFiles(storagePaths: string[]): void {
  const dirs = new Set<string>();
  for (const p of storagePaths) {
    const abs = path.join(STORAGE_DIR, p.replace(/^\//, ''));
    try {
      fs.rmSync(abs, { force: true });
    } catch {
      // File đã mất từ trước thì coi như xong việc.
    }
    dirs.add(path.dirname(abs));
  }
  for (const dir of dirs) {
    pruneIfEmpty(dir); // thư mục mã phiếu
    pruneIfEmpty(path.dirname(dir)); // thư mục ngày
  }
}

@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(requestId: string) {
    return this.prisma.attachment.findMany({
      where: { requestId },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
      orderBy: { uploadedAt: 'asc' },
    });
  }

  async upload(actor: Actor, requestId: string, slot: Slot, files: Express.Multer.File[]) {
    if (!SLOT_DEF[slot]) fail('ERR_NOT_FOUND', 'Ô đính kèm không hợp lệ');
    if (!files?.length) fail('ERR_REQUIRED_FIELD', 'Chưa chọn file');

    const pr = await this.prisma.paymentRequest.findUnique({ where: { id: requestId } });
    if (!pr) fail('ERR_NOT_FOUND', 'Không tìm thấy phiếu');
    if (!canUploadToSlot(actor, pr as never, slot)) {
      fail('ERR_FILE_LOCKED', `Ô "${SLOT_DEF[slot].label}" không mở cho bạn ở bước hiện tại`);
    }

    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'SYSTEM' } });
    const maxMb = cfg?.maxFileSizeMb ?? 25;
    const allowed = cfg?.allowedExtensions ?? [];
    const folder = SLOT_DEF[slot].folder;
    const now = new Date();

    const taken = new Set(
      (await this.prisma.attachment.findMany({ where: { requestId, folder }, select: { fileName: true } })).map((a) => a.fileName),
    );

    const dir = path.join(STORAGE_DIR, STORAGE_ROOT, folder, toDateKey(now), pr.code);
    fs.mkdirSync(dir, { recursive: true });

    const created = [];
    for (const f of files) {
      const original = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const ext = original.includes('.') ? original.split('.').pop()!.toLowerCase() : '';
      if (allowed.length && !allowed.includes(ext)) {
        fail('ERR_FILE_TYPE', `Định dạng .${ext || '?'} không được phép. Cho phép: ${allowed.join(', ')}`);
      }
      if (f.size > maxMb * 1024 * 1024) {
        fail('ERR_FILE_TOO_LARGE', `File "${original}" nặng ${(f.size / 1024 / 1024).toFixed(1)} MB, vượt giới hạn ${maxMb} MB`);
      }
      const fileName = buildFileName(original, now, taken);
      taken.add(fileName);
      fs.writeFileSync(path.join(dir, fileName), f.buffer);
      created.push(
        await this.prisma.attachment.create({
          data: {
            requestId,
            slot,
            stage: pr.status,
            folder,
            fileName,
            storagePath: storagePathOf(folder, pr.code, fileName, now),
            size: f.size,
            mimeType: f.mimetype || 'application/octet-stream',
            uploadedById: actor.id,
          },
        }),
      );
    }

    await this.prisma.paymentRequest.update({ where: { id: requestId }, data: { version: { increment: 1 } } });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'UPLOAD',
        entity: 'attachment',
        entityId: requestId,
        detail: `${pr.code}: tải lên ${created.length} file vào "${SLOT_DEF[slot].label}"`,
      },
    });
    return { attachments: created, message: `Đã tải lên ${created.length} file` };
  }

  async download(id: string, res: Response) {
    const att = await this.prisma.attachment.findUnique({ where: { id } });
    if (!att) fail('ERR_NOT_FOUND', 'Không tìm thấy file');
    const abs = path.join(STORAGE_DIR, att.storagePath.replace(/^\//, ''));
    if (!fs.existsSync(abs)) fail('ERR_NOT_FOUND', 'File không còn trên máy chủ');
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.fileName)}"`);
    fs.createReadStream(abs).pipe(res);
  }

  /** Xóa được khi phiếu còn ở đúng bước đã tải lên và chưa tick chốt; Admin xóa mọi lúc. */
  async remove(actor: Actor, id: string) {
    const att = await this.prisma.attachment.findUnique({ where: { id }, include: { request: true } });
    if (!att) fail('ERR_NOT_FOUND', 'Không tìm thấy file');
    const admin = actor.role === 'ADMIN';
    if (!admin) {
      if (!canUploadToSlot(actor, att.request as never, att.slot as Slot) || att.stage !== att.request.status) {
        fail('ERR_FILE_LOCKED', 'File đã bị khóa theo bước, không thể xóa');
      }
    }
    const abs = path.join(STORAGE_DIR, att.storagePath.replace(/^\//, ''));
    fs.rmSync(abs, { force: true });
    await this.prisma.attachment.delete({ where: { id } });
    await this.prisma.paymentRequest.update({ where: { id: att.requestId }, data: { version: { increment: 1 } } });
    await this.prisma.auditLog.create({
      data: { actorId: actor.id, action: 'DELETE_FILE', entity: 'attachment', entityId: att.requestId, detail: `${att.request.code}: xóa file "${att.fileName}"` },
    });
    return { message: 'Đã xóa file' };
  }
}

@Controller()
export class FilesController {
  constructor(private readonly svc: FilesService) {}

  @Get('payment-requests/:id/attachments')
  list(@Param('id') id: string) {
    return this.svc.list(id);
  }

  @Post('payment-requests/:id/attachments/:slot')
  @UseInterceptors(FilesInterceptor('files', 20))
  upload(
    @CurrentUser() actor: Actor,
    @Param('id') id: string,
    @Param('slot') slot: Slot,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.svc.upload(actor, id, slot, files);
  }

  @Get('attachments/:id/download')
  download(@Param('id') id: string, @Res() res: Response) {
    return this.svc.download(id, res);
  }

  @Delete('attachments/:id')
  remove(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.svc.remove(actor, id);
  }
}

@Module({ controllers: [FilesController], providers: [FilesService, PrismaService], exports: [FilesService] })
export class FilesModule {}
