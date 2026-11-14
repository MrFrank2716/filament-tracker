import { BookOpen, Plus } from 'lucide-react';
import { List, Row } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';

/**
 * The one "add" control on a page asks how, rather than the page carrying a button for each way.
 */
export function AddChooser({ title, catalogue, scratch, onCatalogue, onScratch, onClose }: {
  title: string;
  /** What the catalogue offers here, e.g. "Filament, sheet stock, tooling, fixings and finishes". */
  catalogue: string;
  scratch: { title: string; subtitle: string };
  onCatalogue: () => void;
  onScratch: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <List>
        <Row onClick={onCatalogue} leading={<BookOpen size={20} aria-hidden />} title="From the catalogue" subtitle={catalogue} />
        <Row onClick={onScratch} leading={<Plus size={20} aria-hidden />} title={scratch.title} subtitle={scratch.subtitle} />
      </List>
    </Modal>
  );
}
