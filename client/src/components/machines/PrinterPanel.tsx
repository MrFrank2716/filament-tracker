import { useEffect, useState } from 'react';
import { Badge, Meter, Muted, Readout } from '@/components/ui/Display';
import { PRINTER_CONNECTION, PRINTER_ERROR_TONE, PRINTER_PHASE } from '@/lib/status';
import type { PrinterState, PrinterTemp } from '@/lib/types';
import styles from '@/components/machines/Machines.module.css';

const degrees = (temp: PrinterTemp | null) => (temp?.current === null || temp?.current === undefined ? null : `${Math.round(temp.current)} °C${temp.target ? ` → ${Math.round(temp.target)} °C` : ''}`);

/** "1 h 34 min", "12 min", "under a minute". */
function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** How long ago the figures were taken, for printers that are not reporting right now. */
function age(asOf: number | null, now: number): string {
  if (!asOf) return '';
  const minutes = Math.round((now - asOf) / 60_000);
  if (minutes < 2) return 'a moment ago';
  if (minutes < 90) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

/**
 * What a connected printer is doing right now: state, the print and how long is left, nozzle and bed, and any
 * error codes. Read from the printer; nothing here can be edited. What is loaded shows in the hardware below.
 */
export function PrinterPanel({ state }: { state: PrinterState }) {
  // The time left counts down here between reports, so the server need not send one every minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const phase = PRINTER_PHASE[state.phase];
  const connection = PRINTER_CONNECTION[state.connection];
  const live = state.connection === 'live';
  const waiting = state.connection === 'never_seen' || (state.asOf === null && !live);
  const busy = state.phase === 'printing' || state.phase === 'paused' || state.phase === 'preparing';
  const left = live && busy && state.endsAt ? Math.max(0, state.endsAt - now) : null;

  return (
    <section className={styles.printer} aria-label="Printer status">
      <div className={styles.printerHead}>
        {!waiting && <Badge tone={live ? phase.tone : 'neutral'}>{phase.label}</Badge>}
        {!live && <Badge tone={connection.tone}>{connection.label}</Badge>}
        <Muted>{[state.modelName, state.firmware && `firmware ${state.firmware}`].filter(Boolean).join(' · ')}</Muted>
      </div>
      {!live && <Muted>{[connection.hint, !waiting && state.asOf ? `Last heard from ${age(state.asOf, now)}.` : ''].filter(Boolean).join(' ')}</Muted>}

      {!waiting && state.print && (
        <div className={styles.printJob}>
          <div className={styles.printJobHead}>
            <strong className={styles.printName}>{state.print.name}</strong>
            {state.print.progress !== null && <Readout>{state.print.progress} %</Readout>}
          </div>
          {state.print.progress !== null && <Meter value={state.print.progress} max={100} tone={state.phase === 'failed' ? 'danger' : 'accent'} label={`${state.print.name ?? 'Print'} progress`} />}
          <Muted>
            {[
              state.print.layer !== null && state.print.totalLayers ? `Layer ${state.print.layer} of ${state.print.totalLayers}` : '',
              left !== null ? `about ${duration(left)} left` : '',
            ].filter(Boolean).join(' · ')}
          </Muted>
        </div>
      )}

      {!waiting && (state.extruders.length > 0 || state.bed) && (
        <dl className={styles.printerFacts}>
          {state.extruders.map((extruder) => (
            <div key={extruder.label}>
              <dt>{extruder.label}</dt>
              <dd>
                {[
                  extruder.nozzle.diameter !== null ? `${extruder.nozzle.diameter} mm` : '',
                  extruder.nozzle.type ?? '',
                  live ? degrees(extruder.temp) : '',
                ].filter(Boolean).join(' · ') || 'Unknown'}
              </dd>
            </div>
          ))}
          {live && degrees(state.bed) && (
            <div>
              <dt>Bed</dt>
              <dd>{degrees(state.bed)}</dd>
            </div>
          )}
          {live && degrees(state.chamber) && (
            <div>
              <dt>Chamber</dt>
              <dd>{degrees(state.chamber)}</dd>
            </div>
          )}
        </dl>
      )}

      {!waiting && state.errors.length > 0 && (
        <ul className={styles.printerErrors}>
          {state.errors.map((error) => (
            <li key={error.code}>
              <Badge tone={PRINTER_ERROR_TONE[error.severity]}>{error.severity === 'info' ? 'Notice' : error.severity === 'warning' ? 'Warning' : 'Error'}</Badge>
              {error.url ? (
                <a href={error.url} target="_blank" rel="noreferrer noopener" className={styles.errorCode}>
                  {error.code}
                </a>
              ) : (
                <span className={styles.errorCode}>{error.code}</span>
              )}
              <Muted>{error.url ? 'Opens what the code means on the maker\'s site' : 'Shown on the printer\'s screen'}</Muted>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
