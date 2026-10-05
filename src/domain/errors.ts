export type ErrorCode =
  | 'ERR_REQUIRED_FIELD'
  | 'ERR_AMOUNT_NOT_POSITIVE'
  | 'ERR_DOC_INCOMPLETE'
  | 'ERR_ADV_ZERO'
  | 'ERR_ADV_EXCEED_TOTAL'
  | 'ERR_SETTLE_OVER_BUDGET'
  | 'ERR_PAYMENT_NO_CONFIRM'
  | 'ERR_FINAL_NO_PROOF'
  | 'ERR_SELF_APPROVAL'
  | 'ERR_NO_LEADER'
  | 'ERR_NO_ACCOUNTANT'
  | 'ERR_REASON_REQUIRED'
  | 'ERR_INVALID_TRANSITION'
  | 'ERR_VERSION_CONFLICT'
  | 'ERR_ALREADY_ARCHIVED'
  | 'ERR_NOT_ARCHIVED'
  | 'ERR_ARCHIVE_UNAVAILABLE'
  | 'ERR_FORBIDDEN'
  | 'ERR_NOT_FOUND'
  | 'ERR_FILE_TYPE'
  | 'ERR_FILE_TOO_LARGE'
  | 'ERR_FILE_LOCKED'
  | 'ERR_INVALID_CREDENTIALS'
  | 'ERR_ACCOUNT_LOCKED'
  | 'ERR_ACCOUNT_TEMP_LOCKED'
  | 'ERR_WEAK_PASSWORD'
  | 'ERR_DUPLICATE_USERNAME'
  | 'ERR_DEPARTMENT_OCCUPIED'
  | 'ERR_LAST_ADMIN'
  | 'ERR_CANNOT_DELETE_SELF'
  | 'ERR_USER_IN_USE'
  | 'ERR_MASTER_DATA_IN_USE';

/** Side effect that must survive the rollback of a rejected action (e.g. "báo Admin"). */
export interface AdminAlert {
  title: string;
  message: string;
  requestId: string | null;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly alertAdmins: AdminAlert | null;

  constructor(code: ErrorCode, message: string, alertAdmins: AdminAlert | null = null) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.alertAdmins = alertAdmins;
  }
}

export function fail(code: ErrorCode, message: string, alertAdmins: AdminAlert | null = null): never {
  throw new DomainError(code, message, alertAdmins);
}
