/**
 * Turn two-step sign-in off for one account, for whoever runs the server, when its owner has lost both their
 * phone and their recovery codes:
 *
 *   npm run account:two-step-off -- someone@example.com
 *
 * Make sure the person asking is who they say they are first: this removes the second step for that account.
 * Every device signed in to it is signed out, and the account is emailed.
 */
import { prisma } from '@/db';
import { sendMail } from '@/services/mail';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Use: npm run account:two-step-off -- <email>');
  process.exit(1);
}

try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account uses ${email}.`);
    process.exitCode = 1;
  } else if (!user.totpEnabledAt) {
    console.log(`Two-step sign-in is not on for ${email}. Nothing was changed.`);
  } else {
    await prisma.$transaction([
      prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
      prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, tokenVersion: { increment: 1 } } }),
    ]);
    sendMail({
      to: user.email,
      subject: 'Two-step sign-in was turned off for your Wrkbench account',
      text: [`Hello ${user.name},`, '', 'Whoever runs this copy of Wrkbench turned two-step sign-in off for your account, and every device was signed out.', '', 'Sign in with your password, then turn it on again under Settings, Account.'].join('\n'),
    });
    console.log(`Two-step sign-in is now off for ${email}, and every device was signed out.`);
    // Give the email a moment to leave before the process ends.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
} finally {
  await prisma.$disconnect();
}
