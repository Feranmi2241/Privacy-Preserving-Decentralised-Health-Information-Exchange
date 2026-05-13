import bcrypt from "bcryptjs";
import jwt    from "jsonwebtoken";

// Throw at startup if SESSION_SECRET is not set — never fall back to a
// hardcoded weak default in a deployed environment.
function getJwtSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be set in .env");
  }
  return secret;
}

export const STRONG_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

export function signToken(email: string, hospitalName: string): string {
  return jwt.sign({ email, hospitalName }, getJwtSecret(), { expiresIn: "8h" });
}

export function verifyToken(
  token: string
): { email: string; hospitalName: string } | null {
  try {
    return jwt.verify(token, getJwtSecret()) as { email: string; hospitalName: string };
  } catch {
    return null;
  }
}

// Kept for any future direct use — bcrypt helpers
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
