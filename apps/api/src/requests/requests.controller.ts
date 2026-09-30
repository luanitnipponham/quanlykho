import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/common';
import type { Actor, Status } from '../common/domain';
import { RequestsService, type QueueKey } from './requests.service';
import {
  CommentDto,
  CreateRequestDto,
  FinanceApproveDto,
  ForceDto,
  PayAdvanceDto,
  PayFinalDto,
  ReasonDto,
  SubmitAdvanceDto,
  SubmitDto,
  TransferDto,
  UpdateRequestDto,
  VersionDto,
} from './requests.dto';

@Controller('payment-requests')
export class RequestsController {
  constructor(private readonly svc: RequestsService) {}

  @Get()
  list(@CurrentUser() actor: Actor, @Query('queue') queue?: QueueKey) {
    return this.svc.list(actor, queue ?? 'all');
  }

  /** Must stay above ':id' so "snapshot" is not read as a request id. */
  @Get('snapshot')
  snapshot() {
    return this.svc.snapshot();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Post()
  @Roles('REQUESTER')
  create(@CurrentUser() actor: Actor, @Body() dto: CreateRequestDto) {
    return this.svc.create(actor, dto);
  }

  @Patch(':id')
  update(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: UpdateRequestDto) {
    return this.svc.update(actor, id, dto);
  }

  // ----- T1 → T13 ----------------------------------------------------------

  @Post(':id/submit')
  @Roles('REQUESTER')
  submit(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: SubmitDto) {
    return this.svc.submit(actor, id, dto);
  }

  @Post(':id/cancel')
  @Roles('REQUESTER')
  cancel(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: VersionDto) {
    return this.svc.cancel(actor, id, dto);
  }

  @Post(':id/leader-approve')
  @Roles('LEADER')
  leaderApprove(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: SubmitDto) {
    return this.svc.leaderApprove(actor, id, dto);
  }

  @Post(':id/leader-reject')
  @Roles('LEADER')
  leaderReject(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.svc.leaderReject(actor, id, dto, true);
  }

  @Post(':id/leader-return')
  @Roles('LEADER')
  leaderReturn(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.svc.leaderReject(actor, id, dto, false);
  }

  @Post(':id/submit-advance')
  @Roles('REQUESTER')
  submitAdvance(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: SubmitAdvanceDto) {
    return this.svc.submitAdvance(actor, id, { ...dto, advanceAmount: dto.advanceAmount ?? 0 } as never);
  }

  @Post(':id/finance-approve')
  @Roles('FINANCE_MANAGER')
  financeApprove(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: FinanceApproveDto) {
    return this.svc.financeApprove(actor, id, dto);
  }

  @Post(':id/pay-advance')
  @Roles('ACCOUNTANT')
  payAdvance(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: PayAdvanceDto) {
    return this.svc.payAdvance(actor, id, dto);
  }

  @Post(':id/submit-settlement')
  @Roles('REQUESTER')
  submitSettlement(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: SubmitAdvanceDto) {
    return this.svc.submitSettlement(actor, id, { ...dto, settlementAmount: dto.settlementAmount ?? 0 } as never);
  }

  @Post(':id/pay-final')
  @Roles('ACCOUNTANT')
  payFinal(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: PayFinalDto) {
    return this.svc.payFinal(actor, id, dto);
  }

  @Post(':id/complete-invoice')
  @Roles('REQUESTER')
  completeInvoice(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: VersionDto) {
    return this.svc.completeInvoice(actor, id, dto);
  }

  // ----- A1 → A4 (Admin) ---------------------------------------------------

  @Post(':id/force')
  @Roles('ADMIN')
  force(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: ForceDto & { toStatus: Status }) {
    return this.svc.force(actor, id, dto);
  }

  @Post(':id/admin-cancel')
  @Roles('ADMIN')
  adminCancel(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.svc.adminCancel(actor, id, dto);
  }

  @Post(':id/reopen')
  @Roles('ADMIN')
  reopen(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: ForceDto) {
    return this.svc.reopen(actor, id, dto);
  }

  @Post('transfer')
  @Roles('ADMIN')
  transfer(@CurrentUser() actor: Actor, @Body() dto: TransferDto) {
    return this.svc.transfer(actor, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.svc.remove(actor, id, dto);
  }

  // ----- Collaboration -----------------------------------------------------

  @Post(':id/comments')
  comment(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.svc.comment(actor, id, dto.content);
  }
}
