import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import type { Status } from '../common/domain';

const STATUSES: Status[] = [
  'DRAFT',
  'LEADER_APPROVAL',
  'ADVANCE_PREPARATION',
  'COORDINATION',
  'ADVANCE_PAYMENT',
  'AFTER_ADVANCE',
  'FINAL_PAYMENT',
  'DOCUMENT_SUPPLEMENT_REQUIRED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
];

export class VersionDto {
  @IsInt() @Min(1) version: number;
}

export class CreateRequestDto {
  @IsString() title: string;
  @IsString() projectId: string;
  @IsString() categoryId: string;
  @IsString() requesterNameId: string;
  @IsString() vendorId: string;
  @IsNumber() requestedAmount: number;
  @IsOptional() @IsBoolean() hasInvoice?: boolean;
  @IsOptional() @IsString() note?: string;
  /** Admin creating on behalf of the requester. */
  @IsOptional() @IsString() assignedRequesterId?: string;
}

export class UpdateRequestDto extends CreateRequestDto {
  @IsInt() @Min(1) version: number;
}

export class SubmitDto extends VersionDto {
  @IsBoolean() confirmed: boolean;
  @IsOptional() @IsString() note?: string;
}

export class ReasonDto extends VersionDto {
  @IsOptional() @IsString() reason?: string;
}

export class SubmitAdvanceDto extends VersionDto {
  @IsBoolean() confirmed: boolean;
  @IsOptional() @IsNumber() advanceAmount?: number;
  @IsOptional() @IsNumber() settlementAmount?: number;
}

export class FinanceApproveDto extends VersionDto {
  @IsBoolean() confirmed: boolean;
  @IsIn(['HIGH', 'MEDIUM', 'LOW']) priority: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Nhân viên Kế toán do TPTC chỉ định nhận phiếu (B4). */
  @IsString() accountantNameId: string;
  @IsOptional() @IsString() note?: string;
}

export class PayAdvanceDto extends VersionDto {
  @IsBoolean() checkedDocs: boolean;
  @IsBoolean() paid: boolean;
  @IsOptional() @IsIn(['TRANSFER', 'CASH']) method?: 'TRANSFER' | 'CASH';
  @IsString() paidDate: string;
}

export class PayFinalDto extends VersionDto {
  @IsBoolean() checkedDocs: boolean;
  @IsBoolean() completed: boolean;
  @IsOptional() @IsIn(['TRANSFER', 'CASH']) method?: 'TRANSFER' | 'CASH';
  @IsString() paidDate: string;
}

export class ForceDto extends VersionDto {
  @IsOptional() @IsIn(STATUSES) toStatus?: Status;
  @IsOptional() @IsString() reason?: string;
}

export class TransferItemDto {
  @IsString() id: string;
  @IsInt() version: number;
}

export class TransferDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => TransferItemDto) items: TransferItemDto[];
  @IsString() toRequesterId: string;
  @IsOptional() @IsString() reason?: string;
}

export class CommentDto {
  @IsString() content: string;
}

export class NotifyMissingDocsDto {
  @IsOptional() @IsString() note?: string;
}
