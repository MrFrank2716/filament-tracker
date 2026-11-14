import type { ReferenceFinish } from '@/reference/types';

/**
 * Finishing supplies by type. Coverage and cure time are left to the product the user buys:
 * they vary too much between brands to state generically.
 */

const grits = (values: number[]) => values.map((grit) => ({ label: `P${grit}`, grit }));
const cans = (values: number[]) => values.map((capacity) => ({ label: capacity >= 1000 ? `${capacity / 1000} l` : `${capacity} ml`, capacity }));

const DRY_GRITS = grits([40, 60, 80, 120, 180, 240, 320, 400]);
const AEROSOL = cans([400]);
const TINS = cans([250, 500, 1000]);

export const finishes: ReferenceFinish[] = [
  // Abrasives
  { id: 'fn-disc-125', name: 'Hook and loop sanding disc, 125 mm', kind: 'Sanding disc', size: '125 mm', unit: 'pcs', variants: DRY_GRITS },
  { id: 'fn-disc-150', name: 'Hook and loop sanding disc, 150 mm', kind: 'Sanding disc', size: '150 mm', unit: 'pcs', variants: DRY_GRITS },
  { id: 'fn-sheet', name: 'Sanding sheet, 230 × 280 mm', kind: 'Sanding sheet', size: '230 × 280 mm', unit: 'pcs', variants: grits([60, 80, 120, 180, 240, 320, 400]) },
  { id: 'fn-wetdry', name: 'Wet and dry paper, 230 × 280 mm', kind: 'Sanding sheet', size: '230 × 280 mm', unit: 'pcs', variants: grits([240, 400, 600, 800, 1000, 1200, 1500, 2000, 3000]) },
  { id: 'fn-sponge', name: 'Sanding sponge', kind: 'Sanding sponge', unit: 'pcs', variants: grits([120, 180, 240, 320]) },
  { id: 'fn-belt-75', name: 'Sanding belt, 75 × 533 mm', kind: 'Abrasive', size: '75 × 533 mm', unit: 'pcs', variants: grits([40, 80, 120]) },
  { id: 'fn-roll', name: 'Cloth-backed abrasive roll, 25 mm', kind: 'Abrasive', size: '25 mm × 5 m', unit: 'pcs', variants: grits([80, 120, 180, 240]) },
  { id: 'fn-steelwool', name: 'Steel wool', kind: 'Abrasive', unit: 'pcs', variants: [{ label: '0000' }, { label: '000' }, { label: '00' }, { label: '0' }] },
  // Oils and waxes
  { id: 'fn-danish-oil', name: 'Danish oil', kind: 'Oil', base: 'Oil', unit: 'ml', variants: TINS },
  { id: 'fn-tung-oil', name: 'Tung oil', kind: 'Oil', base: 'Oil', unit: 'ml', variants: TINS },
  { id: 'fn-linseed', name: 'Boiled linseed oil', kind: 'Oil', base: 'Oil', unit: 'ml', variants: TINS },
  { id: 'fn-mineral-oil', name: 'Food-safe mineral oil', kind: 'Oil', base: 'Oil', unit: 'ml', variants: cans([250, 500]) },
  { id: 'fn-hardwax', name: 'Hardwax oil', kind: 'Hardwax oil', base: 'Oil', unit: 'ml', variants: cans([125, 250, 750]) },
  { id: 'fn-paste-wax', name: 'Finishing paste wax', kind: 'Wax', unit: 'ml', variants: cans([250, 500]) },
  // Clear finishes
  { id: 'fn-pu-water-satin', name: 'Water-based polyurethane varnish, satin', kind: 'Varnish', base: 'Water', sheen: 'Satin', unit: 'ml', variants: cans([250, 750, 2500]) },
  { id: 'fn-pu-water-gloss', name: 'Water-based polyurethane varnish, gloss', kind: 'Varnish', base: 'Water', sheen: 'Gloss', unit: 'ml', variants: cans([250, 750, 2500]) },
  { id: 'fn-pu-water-matt', name: 'Water-based polyurethane varnish, matt', kind: 'Varnish', base: 'Water', sheen: 'Matt', unit: 'ml', variants: cans([250, 750, 2500]) },
  { id: 'fn-pu-solvent', name: 'Solvent-based polyurethane varnish', kind: 'Varnish', base: 'Solvent', unit: 'ml', variants: cans([250, 750, 2500]) },
  { id: 'fn-lacquer-spray', name: 'Clear lacquer spray', kind: 'Lacquer', base: 'Solvent', unit: 'ml', variants: AEROSOL },
  { id: 'fn-shellac', name: 'Shellac / French polish', kind: 'Shellac', base: 'Spirit', unit: 'ml', variants: TINS },
  { id: 'fn-sanding-sealer', name: 'Cellulose sanding sealer', kind: 'Sealer', base: 'Solvent', unit: 'ml', variants: TINS },
  { id: 'fn-2k-clear', name: '2K clear coat spray', kind: 'Clear coat', base: 'Two-part', unit: 'ml', variants: AEROSOL },
  // Colour
  { id: 'fn-stain-water', name: 'Water-based wood stain', kind: 'Stain', base: 'Water', unit: 'ml', variants: TINS },
  { id: 'fn-dye-spirit', name: 'Spirit-based wood dye', kind: 'Stain', base: 'Spirit', unit: 'ml', variants: TINS },
  { id: 'fn-primer-acrylic', name: 'Acrylic primer', kind: 'Primer', base: 'Water', unit: 'ml', variants: TINS },
  { id: 'fn-primer-filler', name: 'Filler primer spray', kind: 'Primer', base: 'Solvent', unit: 'ml', variants: AEROSOL },
  { id: 'fn-primer-plastic', name: 'Plastic primer spray', kind: 'Primer', base: 'Solvent', unit: 'ml', variants: AEROSOL },
  { id: 'fn-paint-acrylic', name: 'Acrylic paint', kind: 'Paint', base: 'Water', unit: 'ml', variants: cans([75, 250, 500]) },
  { id: 'fn-paint-airbrush', name: 'Acrylic airbrush paint', kind: 'Paint', base: 'Water', unit: 'ml', variants: cans([17, 60]) },
  { id: 'fn-paint-spray', name: 'Enamel spray paint', kind: 'Paint', base: 'Solvent', unit: 'ml', variants: AEROSOL },
  // Fillers and resins
  { id: 'fn-wood-filler', name: 'Wood filler', kind: 'Filler', base: 'Water', unit: 'ml', variants: cans([250, 500]) },
  { id: 'fn-body-filler', name: 'Two-part body filler', kind: 'Filler', base: 'Two-part', unit: 'ml', variants: cans([250, 500]) },
  { id: 'fn-glazing-putty', name: 'Glazing / spot putty', kind: 'Filler', base: 'Solvent', unit: 'ml', variants: cans([100]) },
  { id: 'fn-epoxy-coating', name: 'Epoxy coating for 3D prints', kind: 'Epoxy resin', base: 'Two-part', unit: 'ml', variants: cans([100, 250]) },
  { id: 'fn-epoxy-casting', name: 'Epoxy casting resin', kind: 'Epoxy resin', base: 'Two-part', unit: 'ml', variants: cans([500, 1000]) },
  // Adhesives
  { id: 'fn-pva', name: 'PVA wood glue', kind: 'Adhesive', base: 'Water', unit: 'ml', variants: cans([250, 500, 1000]) },
  { id: 'fn-ca', name: 'Cyanoacrylate (super glue)', kind: 'Adhesive', unit: 'ml', variants: cans([20, 50]) },
  { id: 'fn-epoxy-glue', name: 'Two-part epoxy adhesive', kind: 'Adhesive', base: 'Two-part', unit: 'ml', variants: cans([25, 50]) },
  { id: 'fn-acrylic-cement', name: 'Solvent cement for acrylic', kind: 'Adhesive', base: 'Solvent', unit: 'ml', variants: cans([50, 100]) },
  // Polishing and cleaning
  { id: 'fn-polish-compound', name: 'Polishing compound', kind: 'Polish', unit: 'ml', variants: cans([100, 250]) },
  { id: 'fn-plastic-polish', name: 'Plastic polish', kind: 'Polish', unit: 'ml', variants: cans([250]) },
  { id: 'fn-ipa', name: 'Isopropyl alcohol, 99%', kind: 'Thinner / cleaner', base: 'Solvent', unit: 'ml', variants: cans([1000, 5000]) },
  { id: 'fn-white-spirit', name: 'White spirit', kind: 'Thinner / cleaner', base: 'Solvent', unit: 'ml', variants: cans([500, 1000]) },
  { id: 'fn-acetone', name: 'Acetone', kind: 'Thinner / cleaner', base: 'Solvent', unit: 'ml', variants: cans([500, 1000]) },
];
