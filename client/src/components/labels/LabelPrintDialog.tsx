import { useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FormGrid, NumberField, SelectField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { clampLabelSize, isLocalAddress, LABEL_MAX_MM, LABEL_MIN_MM, LABEL_PRESETS, QR_QUIET_ZONE, qrShape, rememberLabelSize, storedLabelSize, type Label, type LabelSize } from '@/lib/labels';
import styles from '@/components/labels/Labels.module.css';

/** The code as a crisp vector, so it stays sharp at whatever resolution the printer has. */
function QrCode({ text }: { text: string }) {
  const shape = useMemo(() => qrShape(text), [text]);
  const box = shape.size + QR_QUIET_ZONE * 2;
  return (
    <svg viewBox={`${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${box} ${box}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect x={-QR_QUIET_ZONE} y={-QR_QUIET_ZONE} width={box} height={box} fill="#fff" />
      <path d={shape.path} fill="#000" />
    </svg>
  );
}

export function LabelView({ label, size }: { label: Label; size: LabelSize }) {
  const portrait = size.height > size.width;
  const style = {
    '--label-width': `${size.width}mm`,
    '--label-height': `${size.height}mm`,
    '--label-short': `${Math.min(size.width, size.height)}mm`,
  } as CSSProperties;
  return (
    <div className={`${styles.label} ${portrait ? styles.portrait : ''}`} style={style} data-label={label.key}>
      <div className={styles.code}>
        <QrCode text={label.url} />
      </div>
      <div className={styles.text}>
        <div className={styles.title}>{label.title}</div>
        {label.code && <div className={styles.short}>{label.code}</div>}
        {label.lines.map((line) => (
          <div key={line} className={styles.line}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
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
    window.print();
  };

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
      </FormGrid>

      {labels[0] && (
        <div className={styles.preview}>
          <LabelView label={labels[0]} size={size} />
        </div>
      )}

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
        <div className="label-print-root">
          {/* The page is exactly one label: no margins, nothing else on it. */}
          <style>{`@page { size: ${size.width}mm ${size.height}mm; margin: 0; }`}</style>
          {labels.map((label) => (
            <LabelView key={label.key} label={label} size={size} />
          ))}
        </div>,
        document.body,
      )}
    </Modal>
  );
}
