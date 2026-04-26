import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/schemas/audit-log.schema';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private auditService: AuditService,
  ) {}

  async register(dto: RegisterDto) {
    const user = await this.usersService.create(dto);
    const token = this.signToken(String(user._id), user.email);
    void this.auditService.log({ userId: String(user._id), action: AuditAction.LOGIN, payload: { event: 'register' } });
    return { token, user: this.sanitize(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.usersService.updateLastLogin(String(user._id));
    const token = this.signToken(String(user._id), user.email);
    void this.auditService.log({ userId: String(user._id), action: AuditAction.LOGIN });
    return { token, user: this.sanitize(user) };
  }

  async validateJwt(payload: { sub: string }) {
    return this.usersService.findById(payload.sub);
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }

  private sanitize(user: any) {
    const { passwordHash: _pw, ...rest } = user.toObject();
    return rest;
  }
}
