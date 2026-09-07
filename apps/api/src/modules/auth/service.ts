import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getPrisma } from '../../config/database.js';
import { config } from '../../config/index.js';
import { AppError } from '../../utils/errors.js';
import { BCRYPT_ROUNDS } from '@ai-options/shared';

export interface AuthPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

export class AuthService {
  async register(email: string, password: string, jurisdiction: string): Promise<{ user: { id: string; email: string; status: string; jurisdiction: string; kycStatus: string; riskAcknowledgedAt: string | null; createdAt: Date }; token: string }> {
    const prisma = getPrisma();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw AppError.conflict('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        jurisdiction,
        riskAcknowledgedAt: new Date(),
      },
    });

    // Create default paper wallet
    await prisma.wallet.create({
      data: {
        userId: user.id,
        walletType: 'PAPER',
        chain: 'PAPER',
        status: 'ACTIVE',
      },
    });

    const token = this.generateToken(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        jurisdiction: user.jurisdiction,
        kycStatus: user.kycStatus,
        riskAcknowledgedAt: user.riskAcknowledgedAt?.toISOString() ?? null,
        createdAt: user.createdAt,
      },
      token,
    };
  }

  async login(email: string, password: string): Promise<{ user: { id: string; email: string; status: string; jurisdiction: string; kycStatus: string; riskAcknowledgedAt: string | null; createdAt: Date }; token: string }> {
    const prisma = getPrisma();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw AppError.unauthorized('Invalid credentials');
    }

    if (user.status === 'SUSPENDED') {
      throw AppError.forbidden('Account is suspended');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw AppError.unauthorized('Invalid credentials');
    }

    const token = this.generateToken(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        jurisdiction: user.jurisdiction,
        kycStatus: user.kycStatus,
        riskAcknowledgedAt: user.riskAcknowledgedAt?.toISOString() ?? null,
        createdAt: user.createdAt,
      },
      token,
    };
  }

  async getMe(userId: string) {
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        jurisdiction: true,
        kycStatus: true,
        riskAcknowledgedAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw AppError.notFound('User not found');
    }

    return user;
  }

  private generateToken(userId: string, email: string): string {
    return jwt.sign({ sub: userId, email } satisfies AuthPayload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    } as jwt.SignOptions);
  }
}

export const authService = new AuthService();