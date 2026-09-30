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
