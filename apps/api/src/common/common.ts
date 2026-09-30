// Guards, decorators, response shaping and the audit/notification helpers.
import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable, map } from 'rxjs';
import type { Response } from 'express';
import { deny, type Actor, type Role } from './domain';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  return ctx.switchToHttp().getRequest().user;
});

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

@Injectable()
export class RolesGuard {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;
    const user: Actor | undefined = context.switchToHttp().getRequest().user;
    if (!user) deny('Chưa đăng nhập');
    // Admin passes every role gate (workflow §1.8).
    if (user.role === 'ADMIN' || required.includes(user.role)) return true;
    deny('Vai trò của bạn không truy cập được chức năng này');
  }
}

/** Wraps every successful payload as { success: true, data }. */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        const res: Response = context.switchToHttp().getResponse();
        if (res.getHeader('content-type')?.toString().startsWith('application/octet-stream')) return data;
        return { success: true, data: data ?? null, meta: { timestamp: new Date().toISOString() } };
      }),
    );
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res: Response = host.switchToHttp().getResponse();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as Record<string, unknown> | string;
      if (typeof body === 'object' && body !== null && 'error' in body) {
        res.status(status).json({ ...body, meta: { timestamp: new Date().toISOString() } });
        return;
      }
      const message = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? exception.message);
      res.status(status).json({
        success: false,
        error: { code: codeFor(status), message: Array.isArray(message) ? message.join('; ') : String(message) },
        meta: { timestamp: new Date().toISOString() },
      });
      return;
    }
    // Unexpected failure: log server-side, return a generic message.
    console.error('[unhandled]', exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'ERR_INTERNAL', message: 'Lỗi hệ thống, vui lòng thử lại' },
      meta: { timestamp: new Date().toISOString() },
    });
  }
}

function codeFor(status: number): string {
  if (status === 401) return 'ERR_UNAUTHENTICATED';
  if (status === 403) return 'ERR_FORBIDDEN';
  if (status === 404) return 'ERR_NOT_FOUND';
  if (status === 409) return 'ERR_VERSION_CONFLICT';
  return 'ERR_REQUIRED_FIELD';
}
