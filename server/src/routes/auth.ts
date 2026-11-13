import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/db';
import { requireAuth, signToken } from '@/auth';
import { HttpError, parse } from '@/http';
import { rateLimit } from '@/rateLimit';

export const authRouter = Router();

const credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
});
const registration = credentials.extend({ name: z.string().trim().min(1, 'Enter your name').max(80) });

const publicUser = (user: { id: string; email: string; name: string }) => ({ id: user.id, email: user.email, name: user.name });

// Per client address. Generous enough for a shared workshop connection, tight enough to stop password guessing.
const loginLimit = rateLimit(20, 15 * 60 * 1000);
const registerLimit = rateLimit(10, 60 * 60 * 1000);

authRouter.post('/register', registerLimit, async (req, res) => {
  const { email, password, name } = parse(registration, req.body);
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new HttpError(409, 'An account with that email already exists');
  }
  const user = await prisma.user.create({ data: { email, name, passwordHash: await bcrypt.hash(password, 10) } });
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

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(401, 'Please sign in');
  res.json({ user: publicUser(user) });
});
