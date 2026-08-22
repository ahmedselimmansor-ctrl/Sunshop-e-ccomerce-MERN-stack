/* eslint-disable no-console */
import { createInterface } from 'node:readline/promises';

import { ROLES, type Role } from '@sunshop/shared';

import { connectMongo, disconnectMongo } from '../db/mongoose';
import { User } from '../models/User';
import { hashPassword } from '../security/password';

/**
 * Bootstraps the first staff account.
 *
 * Exists because the API refuses to let anyone assign a role at or above their
 * own rank: which is correct, and also means a fresh deployment has no way to
 * create its first `super_admin` through the API. This script is the deliberate
 * out-of-band path, run as a one-off Kubernetes Job with the cluster's
 * credentials.
 *
 * Reads the password from stdin or the `ADMIN_PASSWORD` env var so it never
 * lands in shell history or a process listing.
 */
async function main(): Promise<void> {
  const email = process.argv[2] ?? process.env.ADMIN_EMAIL;
  const role = (process.argv[3] ?? 'super_admin') as Role;

  if (!email) {
    console.error('Usage: npm run create-admin -w @sunshop/server -- <email> [role]');
    console.error(`Roles: ${ROLES.join(', ')}`);
    process.exit(1);
  }

  if (!ROLES.includes(role)) {
    console.error(`✖ Unknown role "${role}". Valid roles: ${ROLES.join(', ')}`);
    process.exit(1);
  }

  let password = process.env.ADMIN_PASSWORD;

  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('Password (min 10 chars, upper + lower + digit): ');
    rl.close();
  }

  if (
    !password ||
    password.length < 10 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password)
  ) {
    console.error('✖ Password does not meet the policy (10+ chars, upper, lower, digit).');
    process.exit(1);
  }

  await connectMongo();

  const existing = await User.findOne({ email: email.toLowerCase() });

  if (existing) {
    existing.roles = [role];
    existing.status = 'active';
    existing.emailVerified = true;
    existing.passwordHash = await hashPassword(password);
    // Invalidate any session that predates this change.
    existing.tokenVersion += 1;
    await existing.save();
    console.log(`✓ Updated ${email} → role ${role}`);
  } else {
    await User.create({
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      firstName: 'Sunshop',
      lastName: 'Admin',
      roles: [role],
      status: 'active',
      emailVerified: true,
      locale: 'en',
    });
    console.log(`✓ Created ${email} with role ${role}`);
  }
}

main()
  .catch((error: Error) => {
    console.error('✖ Failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo();
    process.exit(process.exitCode ?? 0);
  });
