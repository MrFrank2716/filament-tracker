import { useMemo } from 'react';
import { useWsQuery } from '@/context/WorkspaceContext';
import type { Item, ItemType, Location, Machine, MachineType, Supplier, Unit } from '@/lib/types';

const NONE: never[] = [];
const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));

/** The workspace's own definitions, with lookup maps. Cache entries are shared, so calling this on every screen is cheap. */
export function useCatalog() {
  const unitQuery = useWsQuery<Unit[]>('/units');
  const typeQuery = useWsQuery<ItemType[]>('/item-types');
  const locationQuery = useWsQuery<Location[]>('/locations');
  const supplierQuery = useWsQuery<Supplier[]>('/suppliers');
  const machineQuery = useWsQuery<Machine[]>('/machines');
  const machineTypeQuery = useWsQuery<MachineType[]>('/machine-types');

  const units = unitQuery.data ?? (NONE as Unit[]);
  const types = typeQuery.data ?? (NONE as ItemType[]);
  const locations = locationQuery.data ?? (NONE as Location[]);
  const suppliers = supplierQuery.data ?? (NONE as Supplier[]);
  const machines = machineQuery.data ?? (NONE as Machine[]);
  const machineTypes = machineTypeQuery.data ?? (NONE as MachineType[]);

  const maps = useMemo(
    () => ({
      unitById: byId(units),
      typeById: byId(types),
      locationById: byId(locations),
      supplierById: byId(suppliers),
      machineById: byId(machines),
      machineTypeById: byId(machineTypes),
    }),
    [units, types, locations, suppliers, machines, machineTypes],
  );

  const queries = [unitQuery, typeQuery, locationQuery, supplierQuery, machineQuery, machineTypeQuery];
  return {
    units, types, locations, suppliers, machines, machineTypes,
    ...maps,
    loading: queries.some((q) => q.loading),
    error: queries.find((q) => q.error)?.error,
  };
}

export type Catalog = ReturnType<typeof useCatalog>;

export function useItems() {
  const query = useWsQuery<Item[]>('/items');
  return { items: query.data ?? (NONE as Item[]), loading: query.loading, error: query.error };
}
