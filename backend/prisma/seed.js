// Seeds a demo tenant. Safe to run more than once: it upserts by shop domain.
// Run with: npx prisma db seed
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEMO_TENANT = {
  name: 'Demo Store',
  shopDomain: 'xeno-demo.myshopify.com',
};

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { shopDomain: DEMO_TENANT.shopDomain },
    update: { name: DEMO_TENANT.name },
    create: DEMO_TENANT,
  });

  console.log(`[seed] Demo tenant ready: ${tenant.name} (${tenant.shopDomain}) id=${tenant.id}`);
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
