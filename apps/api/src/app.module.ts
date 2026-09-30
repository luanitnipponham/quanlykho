import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule, Cron } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth';
import { CatalogModule } from './catalog/catalog';
import { FilesModule } from './files/files';
import { PrismaService } from './prisma/prisma.service';
import { RequestsController } from './requests/requests.controller';
import { RequestsService } from './requests/requests.service';
import { AllExceptionsFilter, JwtAuthGuard, RolesGuard, TransformInterceptor } from './common/common';
import { toDateKey, workingDaysElapsed } from './common/domain';

/**
 * Daily housekeeping (workflow §6.7, §8.4):
 * purge the audit log past its retention, then flag and remind overdue B8 invoices once a day.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.run();
  }

  @Cron('0 0 * * *')
  async run(): Promise<void> {
    const now = new Date();
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'SYSTEM' } });
    const retention = cfg?.auditRetentionDays ?? 6;
    const deadline = cfg?.invoiceDeadlineWorkingDays ?? 5;

    await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - retention * 86400_000) } },
    });

    const holidays = new Set((await this.prisma.holiday.findMany()).map((h) => h.date));
    const today = toDateKey(now);
    const open = await this.prisma.paymentRequest.findMany({
      where: { status: 'DOCUMENT_SUPPLEMENT_REQUIRED', invoiceDueStartAt: { not: null }, NOT: { lastLateReminderOn: today } },
    });

    for (const pr of open) {
      if (workingDaysElapsed(pr.invoiceDueStartAt, now, holidays) <= deadline) continue;
      // Lateness raises a flag only — it never changes the status.
      await this.prisma.paymentRequest.update({
        where: { id: pr.id },
        data: { lateInvoice: true, lastLateReminderOn: today },
      });
      const targets = [pr.assignedRequesterId, pr.assignedAccountantId].filter((x): x is string => !!x);
      if (targets.length) {
        await this.prisma.notification.createMany({
          data: targets.map((userId) => ({
            userId,
            requestId: pr.id,
            title: '⏰ Trễ hạn bổ sung hóa đơn',
            message: `${pr.code}: đã quá ${deadline} ngày làm việc kể từ khi vào B8`,
          })),
        });
      }
    }
  }
}

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // Chặn dò mật khẩu và gọi API ồ ạt theo địa chỉ IP (security.md §8).
    // Giới hạn chặt hơn cho /auth/login đặt ngay trên route đó.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 300) }]),
    AuthModule,
    CatalogModule,
    FilesModule,
  ],
  controllers: [RequestsController],
  providers: [
    PrismaService,
    RequestsService,
    SchedulerService,
    // Đặt trước JwtAuthGuard để chặn sớm, không tốn công xác thực token.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
