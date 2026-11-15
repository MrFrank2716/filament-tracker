import { useEffect, useReducer } from 'react';
import { useWsQuery } from '@/context/WorkspaceContext';
import { printerStates, replacePrinterStates, watchPrinterStates } from '@/lib/printerStore';
import type { PrinterFeeder, PrinterState, SubUnit } from '@/lib/types';

/** Every connected printer in this workspace, by machine id. Re-renders as reports arrive over the socket. */
export function usePrinterStates(): Map<string, PrinterState> {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const { data } = useWsQuery<PrinterState[]>('/printers/state');

  useEffect(() => watchPrinterStates(rerender), []);

  // A refresh of the list (after any change in the workspace) is the authority on which printers exist.
  useEffect(() => {
    if (data) replacePrinterStates(data);
  }, [data]);

  return printerStates();
}

/** The live feeder behind a printer-kept unit. Its id ends in the feeder's key: "bambu:<serial>:ams:0". */
export function feederFor(subUnit: SubUnit, state: PrinterState | undefined): PrinterFeeder | undefined {
  if (!subUnit.externalId || !state) return undefined;
  const key = subUnit.externalId.split(':').slice(2).join(':');
  return state.feeders.find((feeder) => feeder.key === key);
}
