import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/db';
import { requireAuth, signToken, verifyToken } from '@/auth';
import { HttpError, parse } from '@/http';
import { rateLimit } from '@/rateLimit';
import { createGuest, GUEST_DAYS, isGuestEmail } from '@/services/guests';

export const authRouter = Router();

const credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
});
const registration = credentials.extend({ name: z.string().trim().min(1, 'Enter your name').max(80) });

const publicUser = (user: { id: string; email: string; name: string; isGuest: boolean }) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  isGuest: user.isGuest,
});

// Per client address. Generous enough for a shared workshop connection, tight enough to stop password guessing.
const loginLimit = rateLimit(20, 15 * 60 * 1000);
const registerLimit = rateLimit(10, 60 * 60 * 1000);
// Each guest session copies the whole example workspace, so these are rationed harder.
const guestLimit = rateLimit(5, 60 * 60 * 1000);

authRouter.post('/register', registerLimit, async (req, res) => {
  const { email, password, name } = parse(registration, req.body);
  if (isGuestEmail(email) || (await prisma.user.findUnique({ where: { email } }))) {
    throw new HttpError(409, 'An account with that email already exists');
  }
  const passwordHash = await bcrypt.hash(password, 10);

  // A guest who registers keeps the same account, and with it everything they set up.
  const header = req.headers.authorization ?? '';
  const currentId = header.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;
  const guest = currentId ? await prisma.user.findFirst({ where: { id: currentId, isGuest: true } }) : null;

  const user = guest
    ? await prisma.user.update({ where: { id: guest.id }, data: { email, name, passwordHash, isGuest: false } })
    : await prisma.user.create({ data: { email, name, passwordHash } });
  res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
});

authRouter.post('/login', loginLimit, async (req, res) => {
  const { email, password } = parse(credentials, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Email or password is incorrect');
  }
  res.json({ token: signToken(user.id), user: publicUser(user) });
});

/** Try the app without an account: a temporary user with their own copy of the example workspace. */
authRouter.post('/guest', guestLimit, async (_req, res) => {
  const user = await createGuest();
  res.status(201).json({ token: signToken(user.id, `${GUEST_DAYS}d`), user: publicUser(user) });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(401, 'Please sign in');
  res.json({ user: publicUser(user) });
});
