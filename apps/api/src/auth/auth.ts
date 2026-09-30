// Đăng nhập bằng username do Admin cấp, khóa tạm sau N lần sai, JWT + refresh (workflow §11.1).
import { Body, Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, Public } from '../common/common';
import { DomainException, ROLE_DEPT_KIND, fail, type Actor } from '../common/domain';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const ACCESS_TTL = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_DAYS = 7;

export class LoginDto {
  @IsString() username: string;
  @IsString() password: string;
}

export class ChangePasswordDto {
  @IsString() oldPassword: string;
  @IsString() @MinLength(8, { message: 'Mật khẩu tối thiểu 8 ký tự' }) newPassword: string;
}

export class RefreshDto {
  @IsString() refreshToken: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false, secretOrKey: JWT_SECRET });
  }

  /** Re-reads the account so a locked user loses an open session immediately (workflow §11.1). */
  async validate(payload: { sub: string }): Promise<Actor> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new DomainException('ERR_ACCOUNT_LOCKED', 'Tài khoản đã bị khóa hoặc không tồn tại', 401);
    }
    return { id: user.id, role: user.role as Actor['role'] };
  }
}

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private async config() {
    return (
      (await this.prisma.systemConfig.findUnique({ where: { key: 'SYSTEM' } })) ?? {
        maxLoginAttempts: 5,
        lockMinutes: 15,
      }
    );
  }

  async login(dto: LoginDto, ip?: string) {
    const username = dto.username.trim();
    const user = await this.prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } });
    const cfg = await this.config();

    if (!user) {
      await this.audit(null, 'LOGIN_FAILED', 'user', null, `Đăng nhập thất bại: username "${username}" không tồn tại`, ip);
      throw new DomainException('ERR_INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu', 401);
    }
    if (user.status === 'LOCKED') {
      await this.audit(user.id, 'LOGIN_FAILED', 'user', user.id, 'Đăng nhập bị từ chối: tài khoản bị khóa', ip);
      throw new DomainException('ERR_ACCOUNT_LOCKED', 'Tài khoản đã bị Admin khóa', 423);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new DomainException('ERR_ACCOUNT_TEMP_LOCKED', `Tài khoản đang bị khóa tạm, thử lại sau ${mins} phút`, 423);
    }

    const ok = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!ok) {
      const count = user.failedLoginCount + 1;
      if (count >= cfg.maxLoginAttempts) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + cfg.lockMinutes * 60000) },
        });
        await this.audit(user.id, 'LOGIN_LOCKED', 'user', user.id, `Sai mật khẩu ${cfg.maxLoginAttempts} lần — khóa tạm ${cfg.lockMinutes} phút`, ip);
        throw new DomainException(
          'ERR_ACCOUNT_TEMP_LOCKED',
          `Sai mật khẩu quá ${cfg.maxLoginAttempts} lần. Tài khoản bị khóa tạm ${cfg.lockMinutes} phút`,
          423,
        );
      }
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: count } });
      await this.audit(user.id, 'LOGIN_FAILED', 'user', user.id, `Sai mật khẩu (lần ${count})`, ip);
      throw new DomainException(
        'ERR_INVALID_CREDENTIALS',
        `Sai tên đăng nhập hoặc mật khẩu (còn ${cfg.maxLoginAttempts - count} lần thử)`,
        401,
      );
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await this.audit(user.id, 'LOGIN', 'user', user.id, 'Đăng nhập thành công', ip);
    return this.issue(user.id, user.role, user.mustChangePassword);
  }

  private async issue(userId: string, role: string, mustChangePassword: boolean) {
    const accessToken = await this.jwt.signAsync({ sub: userId, role }, { expiresIn: ACCESS_TTL });
    const refreshToken = crypto.randomBytes(48).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_DAYS * 86400_000),
      },
    });
    return { accessToken, refreshToken, mustChangePassword, user: await this.me({ id: userId, role: role as Actor['role'] }) };
  }

  async refresh(dto: RefreshDto) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(dto.refreshToken) }, include: { user: true } });
    if (!row || row.revokedAt || row.expiresAt < new Date() || row.user.status !== 'ACTIVE') {
      throw new DomainException('ERR_TOKEN_EXPIRED', 'Phiên đã hết hạn, vui lòng đăng nhập lại', 401);
    }
    // Rotation: the used token is revoked as the new one is issued.
    await this.prisma.refreshToken.update({ where: { tokenHash: row.tokenHash }, data: { revokedAt: new Date() } });
    return this.issue(row.userId, row.user.role, row.user.mustChangePassword);
  }

  async logout(actor: Actor) {
    await this.prisma.refreshToken.updateMany({ where: { userId: actor.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit(actor.id, 'LOGOUT', 'user', actor.id, 'Đăng xuất');
    return {};
  }

  async me(actor: Actor) {
    const u = await this.prisma.user.findUnique({ where: { id: actor.id }, include: { department: true } });
    if (!u) fail('ERR_NOT_FOUND', 'Không tìm thấy tài khoản');
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      role: u.role,
      departmentId: u.departmentId,
      departmentName: u.department?.name ?? null,
      status: u.status,
      mustChangePassword: u.mustChangePassword,
    };
  }

  async changePassword(actor: Actor, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: actor.id } });
    const ok = await argon2.verify(user.passwordHash, dto.oldPassword).catch(() => false);
    if (!ok) throw new DomainException('ERR_INVALID_CREDENTIALS', 'Mật khẩu hiện tại không đúng', 401);
    if (!/[A-Za-z]/.test(dto.newPassword) || !/\d/.test(dto.newPassword)) {
      fail('ERR_WEAK_PASSWORD', 'Mật khẩu tối thiểu 8 ký tự, gồm cả chữ và số');
    }
    if (await argon2.verify(user.passwordHash, dto.newPassword).catch(() => false)) {
      fail('ERR_WEAK_PASSWORD', 'Mật khẩu mới phải khác mật khẩu hiện tại');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(dto.newPassword), mustChangePassword: false },
    });
    await this.audit(user.id, 'CHANGE_PASSWORD', 'user', user.id, 'Đổi mật khẩu');
    return {};
  }

  private audit(actorId: string | null, action: string, entity: string, entityId: string | null, detail: string, ip?: string) {
    return this.prisma.auditLog.create({
      data: { actorId, action, entity, entityId, detail: ip ? `${detail} (IP ${ip})` : detail },
    });
  }
}

export function departmentKindForRole(role: Actor['role']) {
  return ROLE_DEPT_KIND[role];
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Chặt hơn mức chung: 10 lần thử mỗi phút cho mỗi IP. Khóa tài khoản sau 5 lần sai
   * bảo vệ từng tài khoản; giới hạn này chặn việc dò nhiều tài khoản từ cùng một nguồn.
   */
  @Public()
  @Throttle({ default: { limit: Number(process.env.RATE_LIMIT_LOGIN_PER_MINUTE || 10), ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @Get('me')
  me(@CurrentUser() actor: Actor) {
    return this.auth.me(actor);
  }

  @Post('logout')
  logout(@CurrentUser() actor: Actor) {
    return this.auth.logout(actor);
  }

  @Post('change-password')
  changePassword(@CurrentUser() actor: Actor, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(actor, dto);
  }
}

@Module({
  imports: [JwtModule.register({ secret: JWT_SECRET, signOptions: { expiresIn: ACCESS_TTL } })],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PrismaService],
  exports: [AuthService],
})
export class AuthModule {}
