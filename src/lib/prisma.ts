import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,

    // Prisma 7 resolves a nested `include` by running sub-queries in
    // parallel, so a single logical read can need several connections at
    // once. Left at defaults, opening those mid-query surfaces as an opaque
    // "Server has closed the connection" (P1017) whenever the host is under
    // pressure. Explicit pool settings make the behaviour predictable and
    // turn a genuine failure into a clear timeout instead of a dropped socket.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
