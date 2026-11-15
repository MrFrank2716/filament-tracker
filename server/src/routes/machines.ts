import type { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Json } from '@/db';
import { pushConfig } from '@/integrations/bridgeGateway';
import { forgetPrinter } from '@/integrations/registry';
import type { Detected } from '@/integrations/spoolMatch';
import { HttpError, notFound, param, parse } from '@/http';
import { MACHINE_STATUSES, readingSchema } from '@/services/snapshot';
import { assertInWorkspace } from '@/services/stock';

const machineInput = z.object({
  name: z.string().trim().min(1, 'Give the machine a name').max(120),
  machineTypeId: z.string().nullable().optional(),
  manufacturer: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  serial: z.string().trim().max(120).optional(),
  status: z.enum(MACHINE_STATUSES).optional(),
  usageHours: z.number().min(0).optional(),
  hourlyCost: z.number().min(0).optional(),
  locationId: z.string().nullable().optional(),
  notes: z.string().max(5000).optional(),
  compatibleItemIds: z.array(z.string()).optional(),
});

const subUnitInput = z.object({
  name: z.string().trim().min(1, 'Give the unit a name').max(120),
  kind: z.string().trim().max(80).optional(),
  machineId: z.string().nullable().optional(),
  readings: z.array(readingSchema).max(12).optional(),
  statusNote: z.string().trim().max(200).optional(),
  slotCount: z.number().int().min(0).max(64).optional(),
});

const slotInput = z.object({
  itemId: z.string().nullable().optional(),
  label: z.string().trim().max(60).optional(),
});

const machineInclude = { compatibleItems: { where: { archived: false }, select: { id: true } } } satisfies Prisma.MachineInclude;
type MachineRow = Prisma.MachineGetPayload<{ include: typeof machineInclude }>;
const presentMachine = ({ compatibleItems, ...machine }: MachineRow) => ({
  ...machine,
  compatibleItemIds: compatibleItems.map((i) => i.id),
});

const subUnitInclude = { slots: { orderBy: { position: 'asc' } } } satisfies Prisma.SubUnitInclude;

export function registerMachineRoutes(router: Router): void {
  // ---- Machines ------------------------------------------------------------
  router.get('/machines', async (req, res) => {
    const machines = await prisma.machine.findMany({
      where: { workspaceId: req.workspaceId },
      orderBy: { createdAt: 'asc' },
      include: machineInclude,
    });
    res.json(machines.map(presentMachine));
  });

  router.post('/machines', async (req, res) => {
    const { compatibleItemIds = [], ...data } = parse(machineInput, req.body);
    await assertInWorkspace(prisma, req.workspaceId, { machineType: data.machineTypeId, location: data.locationId, item: compatibleItemIds });
    const machine = await prisma.machine.create({
      data: { ...data, workspaceId: req.workspaceId, compatibleItems: { connect: compatibleItemIds.map((id) => ({ id })) } },
      include: machineInclude,
    });
    res.status(201).json(presentMachine(machine));
  });

  router.patch('/machines/:id', async (req, res) => {
    const { compatibleItemIds, ...data } = parse(machineInput.partial(), req.body);
    const id = param(req, 'id');
    await assertInWorkspace(prisma, req.workspaceId, {
      machine: id, machineType: data.machineTypeId, location: data.locationId, item: compatibleItemIds,
    });
    const machine = await prisma.machine.update({
      where: { id },
      data: {
        ...data,
        ...(compatibleItemIds ? { compatibleItems: { set: compatibleItemIds.map((itemId) => ({ id: itemId })) } } : {}),
      },
      include: machineInclude,
    });
    res.json(presentMachine(machine));
  });

  router.delete('/machines/:id', async (req, res) => {
    const id = param(req, 'id');
    await assertInWorkspace(prisma, req.workspaceId, { machine: id });
    const link = await prisma.printerLink.findUnique({ where: { machineId: id }, select: { id: true, bridgeId: true } });
    await prisma.machine.delete({ where: { id } });
    if (link) {
      // The connection went with the machine: stop tracking it and have the bridge drop the printer.
      forgetPrinter(link.id);
      void pushConfig(link.bridgeId);
    }
    res.status(204).end();
  });

  // ---- Sub-units and slots -------------------------------------------------
  router.get('/sub-units', async (req, res) => {
    res.json(
      await prisma.subUnit.findMany({ where: { workspaceId: req.workspaceId }, orderBy: { name: 'asc' }, include: subUnitInclude }),
    );
  });

  router.post('/sub-units', async (req, res) => {
    const { slotCount = 0, readings = [], ...data } = parse(subUnitInput, req.body);
    await assertInWorkspace(prisma, req.workspaceId, { machine: data.machineId });
    const subUnit = await prisma.subUnit.create({
      data: {
        ...data,
        readings: readings as Json,
        workspaceId: req.workspaceId,
        slots: { create: Array.from({ length: slotCount }, (_, index) => ({ position: index + 1 })) },
      },
      include: subUnitInclude,
    });
    res.status(201).json(subUnit);
  });

  /** Changing slotCount adds empty slots at the end, or removes trailing ones (unloading whatever was in them). */
  router.patch('/sub-units/:id', async (req, res) => {
    const { slotCount, readings, ...data } = parse(subUnitInput.partial(), req.body);
    const id = param(req, 'id');
    const existing = await prisma.subUnit.findFirst({ where: { id, workspaceId: req.workspaceId }, include: subUnitInclude });
    if (!existing) throw notFound('Unit');
    await assertInWorkspace(prisma, req.workspaceId, { machine: data.machineId });
    if (existing.externalId) {
      // The printer decides how many trays this has and which machine it hangs off.
      if (slotCount !== undefined && slotCount !== existing.slots.length) throw new HttpError(409, 'A connected printer keeps this unit\'s slots. Unlink the printer to change them by hand.');
      if (data.machineId !== undefined && data.machineId !== existing.machineId) throw new HttpError(409, 'This unit follows its printer. Unlink the printer to move it.');
    }

    const subUnit = await prisma.$transaction(async (tx) => {
      await tx.subUnit.update({ where: { id }, data: { ...data, ...(readings ? { readings: readings as Json } : {}) } });
      if (slotCount !== undefined) {
        const positions = existing.slots.map((s) => s.position);
        await tx.slot.deleteMany({ where: { subUnitId: id, position: { gt: slotCount } } });
        for (let position = 1; position <= slotCount; position++) {
          if (!positions.includes(position)) await tx.slot.create({ data: { subUnitId: id, position } });
        }
      }
      return tx.subUnit.findUniqueOrThrow({ where: { id }, include: subUnitInclude });
    });
    res.json(subUnit);
  });

  router.delete('/sub-units/:id', async (req, res) => {
    const id = param(req, 'id');
    const existing = await prisma.subUnit.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!existing) throw notFound('Unit');
    if (existing.externalId) throw new HttpError(409, 'A connected printer reports this unit, so it would come straight back. Unlink the printer first.');
    await prisma.subUnit.delete({ where: { id } });
    res.status(204).end();
  });

  /** Load, swap or unload a slot. Loading an item that sits elsewhere moves it. */
  router.put('/sub-units/:id/slots/:position', async (req, res) => {
    const { itemId, label } = parse(slotInput, req.body);
    const id = param(req, 'id');
    const position = Number(param(req, 'position'));
    if (!Number.isInteger(position)) throw new HttpError(400, 'Invalid slot');
    const slot = await prisma.slot.findFirst({
      where: { position, subUnitId: id, subUnit: { workspaceId: req.workspaceId } },
    });
    if (!slot) throw notFound('Slot');
    await assertInWorkspace(prisma, req.workspaceId, { item: itemId });

    const updated = await prisma.$transaction(async (tx) => {
      if (itemId) await tx.slot.updateMany({ where: { itemId, NOT: { id: slot.id } }, data: { itemId: null, source: 'manual' } });
      // On a printer-read slot, remember what the tray held when a member chose: their choice then stands until
      // the spool in the tray is physically swapped.
      const detected = slot.detected as Detected | null;
      const tagId = detected?.state === 'loaded' ? detected.tagId : null;
      if (itemId && tagId) {
        // Linking a stock item to a tagged spool teaches the tag, so next time it is recognised without asking.
        await tx.item.updateMany({ where: { workspaceId: req.workspaceId, tagId, NOT: { id: itemId } }, data: { tagId: null } });
        await tx.item.update({ where: { id: itemId }, data: { tagId } });
      }
      return tx.slot.update({
        where: { id: slot.id },
        data: {
          ...(itemId !== undefined ? { itemId, source: 'manual' } : {}),
          ...(itemId !== undefined && detected ? { detected: { ...detected, boundSignature: itemId ? detected.signature : null } as unknown as Json } : {}),
          ...(label !== undefined ? { label } : {}),
        },
      });
    });
    res.json(updated);
  });
}
