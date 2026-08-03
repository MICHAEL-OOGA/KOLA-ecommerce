import "dotenv/config";
import PrismaPackage from "@prisma/client";

const { PrismaClient } = PrismaPackage;
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Check your server/.env file.");
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,

  transactionOptions: {
    maxWait: 10_000,
    timeout: 15_000,
  },
});

export default prisma;
