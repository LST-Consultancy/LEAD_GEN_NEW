import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Mirrors the client-side rule in the signup form. Keep the two in sync. */
export function passwordProblems(plain: string): string[] {
  const problems: string[] = [];
  if (plain.length < 10) problems.push("Use at least 10 characters.");
  if (!/[a-z]/.test(plain)) problems.push("Include a lowercase letter.");
  if (!/[A-Z]/.test(plain)) problems.push("Include an uppercase letter.");
  if (!/[0-9]/.test(plain)) problems.push("Include a number.");
  return problems;
}
