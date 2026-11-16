import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FormGrid, NumberField, SelectField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { clampLabelSize, isLocalAddress, LABEL_MAX_MM, LABEL_MIN_MM, LABEL_PRESETS, labelCode, LINE_SCALE, PRINTER_DPI, QR_QUIET_ZONE, rememberLabelSize, rememberPrinterDpi, storedLabelSize, storedPrinterDpi, TEXT_MIN_MM, type Label, type LabelSize, type PrinterDpi, type QrShape } from '@/lib/labels';
import styles from '@/components/labels/Labels.module.css';

/** The code as a crisp vector, so it stays sharp at whatever resolution the printer has. */
function QrCode({ shape }: { shape: QrShape }) {
  const box = shape.size + QR_QUIET_ZONE * 2;
  return (
    <svg viewBox={`${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${box} ${box}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect x={-QR_QUIET_ZONE} y={-QR_QUIET_ZONE} width={box} height={box} fill="#fff" />
      <path d={shape.path} fill="#000" />
    </svg>
  );
}

/** What had to give for a label's text to fit its size. */
export interface LabelFit {
  /** No room for any text: the label is the QR code alone. */
  codeOnly: boolean;
  /** How many of the parts under the name were left off (place first, then details, then the code). */
  dropped: number;
  /** The name itself had to be shortened. */
  shortened: boolean;
  /** The QR code's squares are finer than scans reliably at this size on this printer. */
  fine: boolean;
}

/** The parts under the name, in the order they are given up when a label is too small for everything. */
const GIVE_UP_ORDER = ['place', 'details', 'code'] as const;
/** Sizes tried, as shares of the starting size: larger where a short name leaves room, then down. */
const STEPS = [2.2, 1.9, 1.65, 1.45, 1.25, 1.12, 1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2];
/** The name may go a little smaller than the lines under it would: it is bold, and it is all that is left by then. */
const NAME_MIN_MM = TEXT_MIN_MM * 1.15;

interface Fitted {
  scale: number;
  dropped: number;
  title: string;
  /** Words too long for a line are allowed to break. Only at the smallest type: larger type never splits a word. */
  breaks: boolean;
}

/**
 * One label, drawn at its real size. Its text is fitted by measuring: the type steps down until everything
 * fits the room beside (or under) the code; if the smallest readable type is still too big, whole parts are
 * left off, least important first; and only a name too long for the label on its own is shortened.
 * Nothing is ever cut by the edge of the label.
 */
export const LabelView = memo(function LabelView({ label, size, dpi, onFit }: { label: Label; size: LabelSize; dpi: PrinterDpi; onFit?: (key: string, fit: LabelFit) => void }) {
  const { shape, layout } = useMemo(() => labelCode(label.url, size, dpi), [size.width, size.height, label.url, dpi]);
  const root = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState<Fitted>({ scale: 1, dropped: 0, title: label.title, breaks: false });
  const parts = GIVE_UP_ORDER.filter((part) => label[part]);

  useLayoutEffect(() => {
    const element = root.current;
    const box = element?.querySelector<HTMLElement>('[data-text]');
    const inner = box?.firstElementChild as HTMLElement | null;
    const name = inner?.querySelector<HTMLElement>('[data-name]')?.firstChild as Text | null;
    if (layout.arrangement === 'code') return onFit?.(label.key, { codeOnly: true, dropped: parts.length, shortened: false, fine: layout.fine });
    // Not laid out (a browser that skips hidden content): leave the starting size rather than guess.
    if (!element || !box || !inner || !name || box.clientHeight === 0) return;

    const optional = parts.map((part) => inner.querySelector<HTMLElement>(`[data-part="${part}"]`)!);
    // Without breaking, a word wider than the line sticks out sideways, which counts as not fitting.
    const fits = () => inner.offsetHeight <= box.clientHeight && inner.scrollWidth <= box.clientWidth + 1;
    const show = (dropped: number, scale: number, title: string, breaks = false) => {
      optional.forEach((part, index) => (part.hidden = index < dropped));
      element.style.setProperty('--fit', String(scale));
      inner.toggleAttribute('data-breaks', breaks);
      name.nodeValue = title;
    };
    const done = (result: Fitted) => {
      show(result.dropped, result.scale, result.title, result.breaks);
      setFitted(result);
      onFit?.(label.key, { codeOnly: false, dropped: result.dropped, shortened: result.title !== label.title, fine: layout.fine });
    };

    // With everything on, then with one part fewer each time. If even the smallest type does not fit, give a
    // part up; otherwise the largest type that fits wins. Fitting only gets easier as type shrinks, so the
    // sizes are searched by halving: a handful of measurements a label, which matters for a few hundred.
    for (let dropped = 0; dropped <= optional.length; dropped++) {
      const alone = dropped === optional.length;
      const smallest = alone ? NAME_MIN_MM / layout.font : TEXT_MIN_MM / (layout.font * LINE_SCALE);
      const sizes = [...STEPS.filter((candidate) => candidate > smallest), smallest];
      // At the smallest type a word too long for a line (a part number) may break; that is the last resort
      // before giving a part up, and the only size at which a word is ever split.
      show(dropped, smallest, label.title);
      if (!fits()) {
        show(dropped, smallest, label.title, true);
        if (fits()) return done({ scale: smallest, dropped, title: label.title, breaks: true });
        continue;
      }
      let low = 0; // index of the largest size not yet ruled out
      let high = sizes.length - 1; // index of a size known to fit
      while (low < high) {
        const middle = (low + high) >> 1;
        show(dropped, sizes[middle], label.title);
        if (fits()) high = middle;
        else low = middle + 1;
      }
      return done({ scale: sizes[high], dropped, title: label.title, breaks: false });
    }

    // Only the name is left, at its smallest, and it is still too long: keep as much of it as fits.
    const scale = NAME_MIN_MM / layout.font;
    let low = 1;
    let high = label.title.length - 1;
    let kept = 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      show(optional.length, scale, `${label.title.slice(0, middle).trimEnd()}…`, true);
      if (fits()) {
        kept = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    // End on a whole word where that does not throw much away.
    const cut = label.title.slice(0, kept);
    const space = cut.lastIndexOf(' ');
    const whole = space >= kept * 0.6 && label.title[kept] !== ' ' ? cut.slice(0, space) : cut;
    done({ scale, dropped: optional.length, title: `${whole.trimEnd()}…`, breaks: true });
    // Fitted once for this label at this size: both parents give each label-and-size its own key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = {
    '--label-width': `${size.width}mm`,
    '--label-height': `${size.height}mm`,
    '--label-padding': `${layout.padding}mm`,
    '--label-gap': `${layout.gap}mm`,
    '--label-qr': `${layout.qr}mm`,
    '--label-font': `${layout.font}mm`,
    '--label-line': LINE_SCALE,
    '--fit': fitted.scale,
  } as CSSProperties;
  return (
    <div ref={root} className={`${styles.label} ${layout.arrangement === 'column' ? styles.column : ''}`} style={style} data-label={label.key} data-arrangement={layout.arrangement}>
      <div className={styles.code}>
        <QrCode shape={shape} />
      </div>
      {layout.arrangement !== 'code' && (
        <div className={styles.text} data-text>
          <div className={styles.fitted} data-breaks={fitted.breaks ? '' : undefined}>
            <div className={styles.title} data-name>
              {fitted.title}
            </div>
            {/* In reading order; which ones are left off on a small label follows GIVE_UP_ORDER. */}
            {(['code', 'details', 'place'] as const).map(
              (part) =>
                label[part] && (
                  <div key={part} className={part === 'code' ? styles.short : styles.line} data-part={part} hidden={parts.indexOf(part) < fitted.dropped}>
                    {label[part]}
                  </div>
                ),
            )}
          </div>
        </div>
      )}
    </div>
  );
});

/** A stable name for one label at one size on one printer: a change of any starts its fitting afresh. */
const fitKey = (label: Label, size: LabelSize, dpi: PrinterDpi) => `${label.key}@${size.width}x${size.height}@${dpi}`;

/** How much of the preview's width and height a label may take, in CSS pixels, before it is shown smaller. */
const PREVIEW_MAX_HEIGHT = 300;
const PX_PER_MM = 96 / 25.4;

const PART_WORDS = { place: 'the location', details: 'the details', code: 'the code' } as const;

/** In words, what small labels in this print job leave off, or null when every label shows everything. */
function fitNote(labels: Label[], fits: Map<string, LabelFit>, size: LabelSize, dpi: PrinterDpi): string | null {
  const results = labels.flatMap((label) => {
    const fit = fits.get(fitKey(label, size, dpi));
    return fit ? [{ fit, left: GIVE_UP_ORDER.filter((part) => label[part]).slice(0, fit.dropped) }] : [];
  });
  if (results.some(({ fit }) => fit.fine)) {
    return 'This label is too small for the QR code to print clearly: its squares come out finer than scans reliably. Choose a larger label, or open Wrkbench at a shorter address before printing (a shorter link makes a simpler code).';
  }
  if (results.some(({ fit }) => fit.codeOnly)) return 'At this size there is room for the QR code only: no text is printed. Choose a larger label to have the name on it.';
  const short = results.filter(({ fit }) => fit.dropped > 0 || fit.shortened);
  if (short.length === 0) return null;
  const one = labels.length === 1;
  const which = one ? 'this label' : short.length === labels.length ? 'these labels' : `${short.length} of these ${labels.length} labels`;
  const left = GIVE_UP_ORDER.filter((part) => short.some((entry) => entry.left.includes(part))).map((part) => PART_WORDS[part]);
  const things = [
    left.length ? `${one ? 'leaves' : 'leave'} off ${left.length > 1 ? `${left.slice(0, -1).join(', ')} and ${left[left.length - 1]}` : left[0]}` : '',
    short.some(({ fit }) => fit.shortened) ? `${one ? 'has' : 'have'} a shortened name` : '',
  ].filter(Boolean);
  return `To keep the text readable at this size, ${which} ${things.join(' and ')}. Scanning the code still shows everything.`;
}

interface Props {
  labels: Label[];
  onClose: () => void;
}

/**
 * Prints labels on a roll label printer: the page is the label. The browser's own print window does the
 * printing, so any printer the computer or phone knows works.
 */
export function LabelPrintDialog({ labels, onClose }: Props) {
  // Kept as typed, so a half-entered number is not corrected under the cursor; the label uses the tidied size.
  const [typed, setTyped] = useState(() => {
    const stored = storedLabelSize();
    return { width: String(stored.width), height: String(stored.height) };
  });
  const size = clampLabelSize({ width: Number(typed.width), height: Number(typed.height) });
  const preset = LABEL_PRESETS.find((candidate) => candidate.width === size.width && candidate.height === size.height);
  const [custom, setCustom] = useState(!preset);
  const origin = window.location.origin;

  const print = () => {
    rememberLabelSize(size);
    rememberPrinterDpi(dpi);
    window.print();
  };

  // What each label had to leave off to fit, as its print copy reports it.
  const [fits, setFits] = useState<Map<string, LabelFit>>(new Map());
  const [dpi, setDpi] = useState<PrinterDpi>(storedPrinterDpi);
  const sizeKey = `${size.width}x${size.height}@${dpi}`;
  const onFit = useCallback((key: string, fit: LabelFit) => setFits((current) => new Map(current).set(`${key}@${sizeKey}`, fit)), [sizeKey]);
  const note = fitNote(labels, fits, size, dpi);

  // The preview is real size where that fits the dialog, and smaller where it does not.
  const preview = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const element = preview.current;
    if (!element) return;
    const measure = () => setRoom(element.clientWidth - 32);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const shrink = room > 0 ? Math.min(1, room / (size.width * PX_PER_MM), PREVIEW_MAX_HEIGHT / (size.height * PX_PER_MM)) : 1;

  return (
    <Modal
      title={labels.length === 1 ? 'Print label' : `Print ${labels.length} labels`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon={Printer} onClick={print} disabled={labels.length === 0}>
            Print
          </Button>
        </>
      }
    >
      <FormGrid>
        <SelectField
          label="Label size"
          value={custom ? 'custom' : (preset?.id ?? 'custom')}
          onChange={(value) => {
            const chosen = LABEL_PRESETS.find((candidate) => candidate.id === value);
            setCustom(!chosen);
            if (chosen) setTyped({ width: String(chosen.width), height: String(chosen.height) });
          }}
        >
          {LABEL_PRESETS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
          <option value="custom">Another size</option>
        </SelectField>
        {custom && (
          <>
            <NumberField label="Width" value={typed.width} onChange={(width) => setTyped((current) => ({ ...current, width }))} suffix="mm" hint={`${LABEL_MIN_MM} to ${LABEL_MAX_MM} mm`} />
            <NumberField label="Height" value={typed.height} onChange={(height) => setTyped((current) => ({ ...current, height }))} suffix="mm" />
          </>
        )}
        <SelectField
          label="Printer"
          value={String(dpi)}
          onChange={(value) => setDpi(PRINTER_DPI.find((candidate) => String(candidate) === value) ?? 203)}
          hint="The QR code is sized to the printer's dots so it prints sharp. Not sure? Leave it at 203."
        >
          <option value="203">203 dpi: most thermal label printers</option>
          <option value="300">300 dpi: Brother QL, Dymo LabelWriter</option>
        </SelectField>
      </FormGrid>

      {labels[0] && (
        <div className={styles.preview} ref={preview}>
          {/* The box takes the shrunken size; the label inside is drawn at real size and scaled to it. */}
          <div className={styles.previewBox} style={{ width: `${size.width * shrink}mm`, height: `${size.height * shrink}mm` }}>
            <div style={{ transform: `scale(${shrink})`, transformOrigin: 'top left' }}>
              <LabelView key={fitKey(labels[0], size, dpi)} label={labels[0]} size={size} dpi={dpi} />
            </div>
          </div>
        </div>
      )}
      {shrink < 1 && <p className={styles.note}>Shown smaller than real size ({size.width} × {size.height} mm).</p>}
      {note && <p className={note.startsWith('This label is too small') ? styles.warning : styles.note}>{note}</p>}

      <p className={styles.note}>
        {labels.length > 1 ? `${labels.length} labels, one per page. ` : ''}
        In the print window choose your label printer, the same paper size as above, no margins and 100% scale.
      </p>
      <p className={isLocalAddress(origin) ? styles.warning : styles.note}>
        Scanning opens <span className={styles.address}>{origin}</span>.{' '}
        {isLocalAddress(origin)
          ? 'Only this computer can open that address, so these labels will not work from a phone. Open Wrkbench at the address everyone uses, then print.'
          : 'Labels keep working as long as Wrkbench stays at this address.'}
      </p>

      {createPortal(
        // Laid out but out of sight on screen (so each label can be measured and fitted); the only thing on paper.
        <div className="label-print-root" aria-hidden>
          {/* The page is exactly one label: no margins, nothing else on it. */}
          <style>{`@page { size: ${size.width}mm ${size.height}mm; margin: 0; }`}</style>
          {labels.map((label) => (
            <LabelView key={fitKey(label, size, dpi)} label={label} size={size} dpi={dpi} onFit={onFit} />
          ))}
        </div>,
        document.body,
      )}
    </Modal>
  );
}
