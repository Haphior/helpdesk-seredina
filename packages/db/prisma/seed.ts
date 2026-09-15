import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@seredina/shared';

// Permission is the one model with no tenant scope (see src/prisma.ts) -- a plain,
// unguarded client is correct here, not a workaround.
const prisma = new PrismaClient();

async function main() {
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
