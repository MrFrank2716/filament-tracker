import { prisma } from '@/db';
import { hashSecret } from '@/services/tokens';

/**
 * Failed attempts per account, alongside the per-address limit: someone guessing one account's password
 * from many addresses is still stopped. Kept in the database, so a restart (every deploy is one) does not
 * hand a guesser a fresh allowance.
 *
 * `attempt` counts before the password is checked, so attempts made in parallel all count; a right password
 * then clears the count. Unknown accounts are counted the same way, so a refusal says nothing about whether
 * an account exists. Only a hash of the key is stored.
 */
export function attemptCounter(kind: string, max: number, windowMs: number) {
  const keyFor = (subject: string) => hashSecret(`${kind}:${subject}`);
  return {
    /** Records one attempt, or returns false (recording nothing) when the allowance is used up. */
    async attempt(subject: string, now = Date.now()): Promise<boolean> {
      const key = keyFor(subject);
      // Written first and counted after, each a single statement: two attempts at once both see each other.
      const mine = await prisma.signInAttempt.create({ data: { key, at: new Date(now) } });
      const recent = await prisma.signInAttempt.count({ where: { key, at: { gt: new Date(now - windowMs) } } });
      if (recent <= max) return true;
      // A refused attempt is not kept, so the lock lifts once the counted ones are old, not later with each new try.
      await prisma.signInAttempt.delete({ where: { id: mine.id } }).catch(() => undefined);
      return false;
    },
    /** Forget the attempts, once the account has proved who it is: the right password, or a password reset. */
    async clear(subject: string): Promise<void> {
      await prisma.signInAttempt.deleteMany({ where: { key: keyFor(subject) } });
    },
  };
}

/** Attempts older than any window in use count for nothing: remove them. */
export async function forgetOldAttempts(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  return (await prisma.signInAttempt.deleteMany({ where: { at: { lt: new Date(Date.now() - olderThanMs) } } })).count;
}
