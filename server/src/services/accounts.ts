import { prisma } from '@/db';
import { removeWorkspaceUploads } from '@/services/uploads';

/**
 * Delete users together with every workspace that would be left with no member at all.
 * Workspaces they share with others stay; what they logged there is kept without their name.
 */
export async function removeUsers(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId: { in: ids } }, every: { userId: { in: ids } } } },
    select: { id: true },
  });
  for (const { id } of workspaces) {
    await prisma.workspace.delete({ where: { id } });
    // Files sent with job requests live on disk, outside the database.
    await removeWorkspaceUploads(id);
  }
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

/** Names of shared workspaces that would be left without an owner if this user went away. */
export async function workspacesOnlyOwnedBy(userId: string): Promise<string[]> {
  const owned = await prisma.membership.findMany({
    where: { userId, role: 'owner' },
    include: { workspace: { include: { members: { select: { userId: true, role: true } } } } },
  });
  return owned
    .filter(({ workspace }) => workspace.members.length > 1 && !workspace.members.some((m) => m.role === 'owner' && m.userId !== userId))
    .map(({ workspace }) => workspace.name);
}
