import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import styles from '@/pages/LegalPages.module.css';

/**
 * Legal contact shown on the policy pages.
 * Also review both documents with a lawyer for the jurisdictions you serve.
 */
export const LEGAL_CONTACT = 'hello@wrkbench.xyz';
const UPDATED = '14 November 2026';

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <article className={styles.doc}>
        <p className={styles.back}>
          <Link to="/">Back to Wrkbench</Link>
        </p>
        <h1>{title}</h1>
        <p className={styles.meta}>Last updated {UPDATED}</p>
        {children}
        <p className={styles.meta}>
          <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Service</Link> ·{' '}
          <Link to="/notices">Open-source notices</Link>
        </p>
      </article>
    </main>
  );
}

export function PrivacyPage() {
  return (
    <Doc title="Privacy Policy">
      <p>
        Wrkbench is a workshop inventory and maintenance manager. This policy explains what personal data it handles and
        why. Contact: <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
      </p>

      <h2>Who is responsible for your data</h2>
      <p>
        For your account, the Wrkbench operator is the controller. For job requests sent to a workshop, the workshop
        (the workspace owner) decides what is done with the requester&apos;s details and is the controller; Wrkbench
        processes that data on its behalf.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account:</strong> your name, email address and a hashed password. Guest sessions use a throwaway
          address and are deleted after 7 days.
        </li>
        <li>
          <strong>Workspace data you enter:</strong> inventory, machines, suppliers, jobs, maintenance records, and an
          activity log that records which member did what.
        </li>
        <li>
          <strong>Job requests (no account needed):</strong> the requester&apos;s name, email address, request text,
          comments and any files they upload.
        </li>
        <li>
          <strong>On your device:</strong> a sign-in token and display preferences are kept in your browser&apos;s local
          storage. Wrkbench sets no cookies and uses no analytics or advertising trackers.
        </li>
        <li>
          <strong>Technical:</strong> your IP address is used briefly in memory for rate limiting and is not stored by
          the application. Our hosting provider may keep ordinary server logs.
        </li>
      </ul>

      <h2>Why we use it</h2>
      <p>
        To provide the service you asked for (sign-in, running a workspace, handling a request), to keep it secure, and
        to send service emails such as password resets and request status updates. Where the law requires a legal basis,
        that is performing a contract with you or our legitimate interest in running a secure service.
      </p>

      <h2>Who we share it with</h2>
      <ul>
        <li>
          <strong>Resend</strong> delivers our emails, so recipient addresses and message contents pass through it.
        </li>
        <li>
          <strong>Our hosting provider</strong> stores the database and uploaded files.
        </li>
        <li>Other members of a workspace can see the workspace data and activity you create in it.</li>
      </ul>
      <p>We do not sell personal data.</p>

      <h2>How long we keep it</h2>
      <p>
        Account and workspace data is kept until you delete it. Deleting your account removes workspaces you were the
        only member of; in shared workspaces your name may remain in the activity log. Guest data is removed after 7
        days. Requester details and files stay in the workspace until the workspace owner deletes them.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live (for example under the GDPR/UK GDPR or CCPA) you can ask to access, correct, export
        or delete your data and to object to processing. You can delete your account and export your workspace from
        Settings. If you sent a job request without an account, or want anything else, email{' '}
        <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>. You may also complain to your data protection authority.
      </p>

      <h2>Children</h2>
      <p>Wrkbench is not directed at children under 13 (16 in some countries). Schools and groups must have the right permissions before enrolling younger users.</p>

      <h2>Changes</h2>
      <p>We will update the date above when this policy changes.</p>
    </Doc>
  );
}

export function TermsPage() {
  return (
    <Doc title="Terms of Service">
      <p>
        By creating an account, continuing as a guest, or sending a job request you agree to these terms and to the{' '}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>

      <h2>Using Wrkbench</h2>
      <ul>
        <li>You must be old enough to form a binding agreement (at least 13, or 16 where local law requires).</li>
        <li>Keep your sign-in details secure; you are responsible for activity under your account.</li>
        <li>Do not misuse the service: no attacks, scraping at scale, or attempts to access other people&apos;s data.</li>
      </ul>

      <h2>Your content and uploads</h2>
      <p>
        You keep ownership of what you enter or upload. You confirm you have the right to upload it and that it does not
        infringe others&apos; rights, is not unlawful, and is not designed to cause harm (for example, files for making
        weapons or illegal items). Workspace owners may remove content and members.
      </p>

      <h2>Workspaces and requests</h2>
      <p>
        A workshop that collects job requests is responsible for how it uses requesters&apos; details and for complying
        with the law that applies to it. Submitting a request does not guarantee that anything will be made.
      </p>

      <h2>Guest sessions</h2>
      <p>Guest data is temporary and is deleted after 7 days. Create an account to keep your work.</p>

      <h2>Third-party names</h2>
      <p>
        Example data may mention brands such as Bambu Lab, Makera and Hozo. Wrkbench is not affiliated with,
        sponsored or endorsed by them, and their names belong to their owners.
      </p>

      <h2>No warranty and liability</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; without warranties. Keep your own backups. To the extent the law
        allows, the operator is not liable for indirect or consequential losses, and total liability is limited to the
        amount you paid for the service (which may be nothing). Nothing limits liability that cannot be limited by law.
      </p>

      <h2>Ending your use</h2>
      <p>You can delete your account at any time in Settings. We may suspend accounts that break these terms.</p>

      <h2>Changes and law</h2>
      <p>
        We may update these terms and will change the date above. Set the governing law and venue that apply to the
        operator before launch. Questions: <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
      </p>
    </Doc>
  );
}

export function NoticesPage() {
  return (
    <Doc title="Open-source notices">
      <p>
        Wrkbench is built with open-source software, mostly under the MIT, ISC, BSD-3-Clause and Apache-2.0 licences.
        Each package&apos;s licence text ships with it in <code>node_modules</code> and in the upstream repositories.
      </p>
      <ul>
        <li>
          <strong>Archivo</strong> (via <code>@fontsource-variable/archivo</code>) and <strong>IBM Plex Mono</strong>{' '}
          (via <code>@fontsource/ibm-plex-mono</code>) are licensed under the SIL Open Font License 1.1.
        </li>
        <li>
          <strong>Lucide</strong> icons are licensed under the ISC licence.
        </li>
        <li>
          <strong>React, Express, Prisma, socket.io</strong> and the other dependencies are licensed under their own
          permissive licences, listed in <code>package-lock.json</code>.
        </li>
      </ul>
    </Doc>
  );
}

/** Small consent line for sign-up and public forms. */
export function LegalNote({ action }: { action: string }) {
  return (
    <p className={styles.consent}>
      By {action} you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.
    </p>
  );
}
