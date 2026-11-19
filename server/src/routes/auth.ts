import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/db';
import { bearerToken, requireAuth, signResetToken, signToken, userForReset, userForSession } from '@/auth';
import { HttpError, parse } from '@/http';
import { attemptCounter, rateLimit } from '@/rateLimit';
import { removeUsers, workspacesOnlyOwnedBy } from '@/services/accounts';
import { createGuest, GUEST_DAYS, isGuestEmail } from '@/services/guests';
import { appUrl, sendMail } from '@/services/mail';

export const authRouter = Router();

const emailField = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));
const newPassword = z.string().min(8, 'Use at least 8 characters').max(200);
const credentials = z.object({ email: emailField, password: newPassword });
const registration = credentials.extend({ name: z.string().trim().min(1, 'Enter your name').max(80) });

interface UserRecord {
  id: string;
  email: string;
  name: string;
  isGuest: boolean;
  themeMode: string;
  themePreset: string;
  themeAccent: string | null;
  navLayout: string | null;
  dailyReportAuto: boolean;
}

// Keep in step with NAV_IDS in client/src/lib/navigation.ts.
const NAV_IDS = ['overview', 'inventory', 'locations', 'jobs', 'maintenance', 'machines', 'reorder', 'activity', 'settings'] as const;
const MAX_TAB_BAR = 4;

const uniquePages = (ids: readonly string[]) => new Set(ids).size === ids.length;
/** Pages taken out of one device's navigation. Settings stays, or there would be no way back. */
const hiddenPages = z
  .array(z.enum(NAV_IDS))
  .refine(uniquePages, 'A page can only be hidden once')
  .refine((ids) => !ids.includes('settings'), 'Settings cannot be hidden')
  .default([]);

const navigationInput = z.object({
  /** Null puts the standard layout back. */
  layout: z
    .object({
      order: z
        .array(z.enum(NAV_IDS))
        .refine((ids) => ids.length === NAV_IDS.length && uniquePages(ids), 'List every page exactly once'),
      tabBar: z
        .array(z.enum(NAV_IDS))
        .min(1, 'Keep at least one page in the tab bar')
        .max(MAX_TAB_BAR, `The tab bar holds up to ${MAX_TAB_BAR} pages`)
        .refine(uniquePages, 'A page can only be in the tab bar once'),
      hiddenDesktop: hiddenPages,
      hiddenPhone: hiddenPages,
    })
    .refine((layout) => !layout.tabBar.some((id) => layout.hiddenPhone.includes(id)), 'A page hidden on a phone cannot be in the tab bar')
    .nullable(),
});

const preferencesInput = z.object({ dailyReportAuto: z.boolean() });

/** Stored as text. Anything unreadable counts as "no custom layout"; the client fills gaps from the standard one. */
function readNavLayout(stored: string | null): unknown {
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

const publicUser = (user: UserRecord) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  isGuest: user.isGuest,
  appearance: { mode: user.themeMode, preset: user.themePreset, accent: user.themeAccent },
  navigation: readNavLayout(user.navLayout),
  dailyReportAuto: user.dailyReportAuto,
});

// Keep in step with PRESETS in client/src/lib/themes.ts.
const THEME_PRESETS = ['graphite', 'slate', 'paper', 'night'] as const;

const appearanceInput = z.object({
  mode: z.enum(['system', 'light', 'dark']),
  preset: z.enum(THEME_PRESETS),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2457b8')
    .transform((hex) => hex.toLowerCase())
    .nullable(),
});

// Per client address. Generous enough for a shared workshop connection, tight enough to stop password guessing.
const loginLimit = rateLimit(20, 15 * 60 * 1000);
const registerLimit = rateLimit(10, 60 * 60 * 1000);
// Each guest session copies the whole example workspace, so these are rationed harder.
const guestLimit = rateLimit(5, 60 * 60 * 1000);
// Both check the current password, so they are guessing targets like sign-in.
const passwordLimit = rateLimit(10, 15 * 60 * 1000);
const forgotLimit = rateLimit(5, 60 * 60 * 1000);
const resetLimit = rateLimit(10, 60 * 60 * 1000);
const resetCheckLimit = rateLimit(30, 60 * 60 * 1000);
// Per email, from any address: stops one account's password being guessed from many connections.
// Kept generous because anyone can use it up for someone else's email, locking them out for a while.
const accountAttempts = attemptCounter(10, 15 * 60 * 1000);

authRouter.post('/register', registerLimit, async (req, res) => {
  const { email, password, name } = parse(registration, req.body);
  if (isGuestEmail(email) || (await prisma.user.findUnique({ where: { email } }))) {
    throw new HttpError(409, 'An account with that email already exists');
  }
  const passwordHash = await bcrypt.hash(password, 10);

  // A guest who registers keeps the same account, and with it everything they set up.
  const current = await userForSession(bearerToken(req.headers.authorization));

  const user = current?.isGuest
    ? await prisma.user.update({ where: { id: current.id }, data: { email, name, passwordHash, isGuest: false } })
    : await prisma.user.create({ data: { email, name, passwordHash } });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

authRouter.post('/login', loginLimit, async (req, res) => {
  const { email, password } = parse(credentials, req.body);
  if (!accountAttempts.attempt(email)) {
    throw new HttpError(429, 'Too many sign-in attempts for this email. Wait 15 minutes, or use Forgot password? to choose a new one.');
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Email or password is incorrect');
  }
  accountAttempts.clear(email);
  res.json({ token: signToken(user), user: publicUser(user) });
});

/** Try the app without an account: a temporary user with their own copy of the example workspace. */
authRouter.post('/guest', guestLimit, async (_req, res) => {
  const user = await createGuest();
  res.status(201).json({ token: signToken(user, `${GUEST_DAYS}d`), user: publicUser(user) });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(401, 'Please sign in');
  res.json({ user: publicUser(user) });
});

/** A personal preference: any signed-in user, guests included, may set their own. */
authRouter.patch('/me/appearance', requireAuth, async (req, res) => {
  const { mode, preset, accent } = parse(appearanceInput, req.body);
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { themeMode: mode, themePreset: preset, themeAccent: accent },
  });
  res.json({ user: publicUser(user) });
});

/** Also personal: the order of the main navigation, what sits in the phone tab bar, and pages hidden per device. */
authRouter.patch('/me/navigation', requireAuth, async (req, res) => {
  const { layout } = parse(navigationInput, req.body);
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { navLayout: layout ? JSON.stringify(layout) : null },
  });
  res.json({ user: publicUser(user) });
});

/** Also personal: whether the daily report opens by itself on the first visit of the day. */
authRouter.patch('/me/preferences', requireAuth, async (req, res) => {
  const { dailyReportAuto } = parse(preferencesInput, req.body);
  const user = await prisma.user.update({ where: { id: req.userId }, data: { dailyReportAuto } });
  res.json({ user: publicUser(user) });
});

// ---- Password and sessions ---------------------------------------------------

/** The signed-in user, once they have proved they know the current password. Guests have none. */
async function confirmPassword(userId: string, password: unknown) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(401, 'Please sign in');
  if (user.isGuest) throw new HttpError(400, 'Guest sessions have no password. Create an account first.');
  if (typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  return user;
}

/** Raising the version revokes every token and reset link issued so far. The caller gets a fresh token. */
const revokeSessions = (userId: string, data: { passwordHash?: string } = {}) =>
  prisma.user.update({ where: { id: userId }, data: { ...data, tokenVersion: { increment: 1 } } });

authRouter.post('/password', passwordLimit, requireAuth, async (req, res) => {
  const { currentPassword, password } = parse(z.object({ currentPassword: z.string(), password: newPassword }), req.body);
  await confirmPassword(req.userId, currentPassword);
  const user = await revokeSessions(req.userId, { passwordHash: await bcrypt.hash(password, 10) });
  res.json({ token: signToken(user), user: publicUser(user) });
});

/** Signs out every other device; this one carries on with a new token. */
authRouter.post('/sign-out-others', requireAuth, async (req, res) => {
  const user = await revokeSessions(req.userId);
  res.json({ token: signToken(user, user.isGuest ? `${GUEST_DAYS}d` : '30d'), user: publicUser(user) });
});

authRouter.post('/delete-account', passwordLimit, requireAuth, async (req, res) => {
  const user = await confirmPassword(req.userId, req.body?.password);
  const stranded = await workspacesOnlyOwnedBy(user.id);
  if (stranded.length > 0) {
    throw new HttpError(
      409,
      `You are the only owner of ${stranded.map((name) => `"${name}"`).join(', ')}, which other people use. Make someone else an owner or delete it first.`,
    );
  }
  await removeUsers([user.id]);
  res.status(204).end();
});

// ---- Forgotten password ------------------------------------------------------

const RESET_MAIL_GAP_MS = 2 * 60 * 1000;
const lastResetMail = new Map<string, number>();

/** The answer is the same whether or not the address has an account, so this cannot be used to find out who does. */
authRouter.post('/forgot', forgotLimit, async (req, res) => {
  const { email } = parse(z.object({ email: emailField }), req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const now = Date.now();
  if (user && !user.isGuest && now - (lastResetMail.get(user.id) ?? 0) > RESET_MAIL_GAP_MS) {
    lastResetMail.set(user.id, now);
    if (lastResetMail.size > 5000) {
      for (const [id, at] of lastResetMail) if (now - at > RESET_MAIL_GAP_MS) lastResetMail.delete(id);
    }
    // The token rides in the fragment, which browsers never send to a server, so it stays out of request logs.
    const link = appUrl(`/reset-password#token=${signResetToken(user)}`);
    sendMail({
      to: user.email,
      subject: 'Reset your Wrkbench password',
      text: [
        `Hello ${user.name},`,
        '',
        'Someone asked to reset the password for your Wrkbench account. To choose a new one, open this link within an hour:',
        '',
        link,
        '',
        'If that was not you, ignore this email. Your password stays as it is.',
      ].join('\n'),
    });
  }
  res.json({ message: 'If that email has an account, a link to choose a new password is on its way.' });
});

const RESET_LINK_DEAD = 'This link has expired or was already used. Ask for a new one.';

/** Lets the reset page say straight away that a link is used up, instead of after the new password is typed. */
authRouter.post('/reset-check', resetCheckLimit, async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(1).max(2000) }), req.body);
  const user = await userForReset(token);
  if (!user || user.isGuest) throw new HttpError(400, RESET_LINK_DEAD);
  res.status(204).end();
});

authRouter.post('/reset', resetLimit, async (req, res) => {
  const { token, password } = parse(z.object({ token: z.string().min(1).max(2000), password: newPassword }), req.body);
  const user = await userForReset(token);
  if (!user || user.isGuest) throw new HttpError(400, RESET_LINK_DEAD);
  // Raising the version makes the link single-use and signs out every device that knew the old password.
  const updated = await revokeSessions(user.id, { passwordHash: await bcrypt.hash(password, 10) });
  // They proved they own the email: a lock-out from earlier guesses should not stop them on another device.
  accountAttempts.clear(user.email);
  res.json({ token: signToken(updated), user: publicUser(updated) });
});
