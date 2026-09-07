import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed script: creates the admin user from ADMIN_EMAIL env var.
 * Run with: pnpm --filter @ai-options/api run db:seed
 */
async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'adminpass123';

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    console.log(`Admin user ${adminEmail} already exists`);
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      jurisdiction: 'US',
      riskAcknowledgedAt: new Date(),
      kycStatus: 'APPROVED',
    },
  });

  await prisma.wallet.create({
    data: {
      userId: admin.id,
      walletType: 'PAPER',
      chain: 'PAPER',
      status: 'ACTIVE',
    },
  });

  console.log(`Created admin user ${adminEmail} (id: ${admin.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });