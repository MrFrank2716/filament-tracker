import { useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, ErrorNote, Loading, Muted, SectionTitle } from '@/components/ui/Display';
import { SelectField, TextField } from '@/components/ui/Form';
import { useConfirm } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useAction } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import type { Member, Role } from '@/lib/types';
import styles from '@/components/settings/Settings.module.css';

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including members, settings and deleting the workspace.',
  admin: 'Add, change and delete stock, machines, jobs and maintenance. Review requests and undo stock edits.',
  operator: 'Run jobs, log what was used and maintenance done, load spools, reply to requests. Cannot add stock, edit the inventory or delete anything.',
  viewer: 'Look only. Good for students or visitors.',
};

export function MembersSection() {
  const { user } = useAuth();
  const { isOwner, wsPath } = useWorkspace();
  const { data: members, error } = useWsQuery<Member[]>('/members');
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('operator');

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!members) return <Loading />;

  const invite = async () => {
    if (await run(() => api.post(wsPath('/members')!, { email: email.trim(), role }), 'Member added')) setEmail('');
  };
  const remove = async (member: Member) => {
    const ok = await confirm({ title: 'Remove member?', message: `${member.name} will lose access to this workspace.`, confirmLabel: 'Remove', danger: true });
    if (ok) await run(() => api.delete(wsPath(`/members/${member.id}`)!), 'Member removed');
  };

  return (
    <>
      <SectionTitle count={members.length}>Members</SectionTitle>
      <ul className={styles.members}>
        {members.map((member) => (
          <li key={member.id} className={styles.member}>
            <div className={styles.memberText}>
              <strong>
                {member.name}
                {member.userId === user?.id ? ' (you)' : ''}
              </strong>
              <Muted>{member.email}</Muted>
            </div>
            {isOwner ? (
              <Select
                compact
                wrapClassName={styles.roleSelect}
                value={member.role}
                aria-label={`Role for ${member.name}`}
                disabled={busy}
                onChange={(e) => run(() => api.patch(wsPath(`/members/${member.id}`)!, { role: e.target.value }), 'Role updated')}
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="operator">Operator</option>
                <option value="viewer">Viewer</option>
              </Select>
            ) : (
              <Badge tone={member.role === 'owner' ? 'accent' : 'neutral'}>{member.role}</Badge>
            )}
            {isOwner && member.userId !== user?.id && <IconButton icon={Trash2} label={`Remove ${member.name}`} onClick={() => remove(member)} />}
          </li>
        ))}
      </ul>

      <dl className={styles.roles}>
        {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
          <div key={r}>
            <dt>{r}</dt>
            <dd>{ROLE_HELP[r]}</dd>
          </div>
        ))}
      </dl>

      {isOwner && (
        <form
          className={styles.invite}
          onSubmit={(event) => {
            event.preventDefault();
            void invite();
          }}
        >
          <TextField label="Add someone by email" type="email" value={email} onChange={setEmail} placeholder="name@example.com" hint="They need to have created an account first." />
          <SelectField label="Role" value={role} onChange={(value) => setRole(value as Role)}>
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
            <option value="owner">Owner</option>
          </SelectField>
          <Button type="submit" variant="primary" icon={UserPlus} disabled={busy || !email.trim()}>
            Add
          </Button>
        </form>
      )}
    </>
  );
}
