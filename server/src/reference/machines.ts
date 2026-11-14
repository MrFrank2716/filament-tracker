import type { ReferenceAttachment, ReferenceMachine, ReferenceTask, Spec } from '@/reference/types';

/**
 * Machines and equipment. Branded specs were checked against each maker's own site (product pages,
 * spec sheets, support articles) in November 2026; where the maker's own figures disagreed or
 * could not be found, the spec is left out rather than guessed. Discontinued models stay listed
 * because people still own them. Generic equipment
 * (sanders, extractors, bandsaws…) carries no brand and only the specs that define it.
 */

const volume = (x: number, y: number, z: number): Spec => ({ label: 'Build volume', value: `${x} × ${y} × ${z}`, unit: 'mm' });
const area = (x: number, y: number, z?: number): Spec => ({ label: 'Work area', value: z ? `${x} × ${y} × ${z}` : `${x} × ${y}`, unit: 'mm' });
const laser = (watts: number, type: string): Spec[] => [{ label: 'Laser power', value: String(watts), unit: 'W' }, { label: 'Laser type', value: type }];
const spec = (label: string, value: string, unit?: string): Spec => ({ label, value, ...(unit ? { unit } : {}) });

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

type Draft = Omit<ReferenceMachine, 'id'> & { id?: string };
const machine = (draft: Draft): ReferenceMachine => ({ ...draft, id: draft.id ?? `mc-${slug(`${draft.brand} ${draft.model}`)}` });
const generic = (model: string, machineType: ReferenceMachine['machineType'], rest: Partial<Draft> = {}) =>
  machine({ brand: '', model, machineType, specs: [], ...rest });

// ---- Attachments ----------------------------------------------------------

const unit = (id: string, name: string, kind: string, slots: number, builtIn = false): ReferenceAttachment => ({ id, name, kind, slots, ...(builtIn ? { builtIn } : {}) });

const AMS = unit('ams', 'AMS', '4-slot feeder', 4);
const AMS_2_PRO = unit('ams-2-pro', 'AMS 2 Pro', '4-slot feeder and dryer', 4);
const AMS_HT = unit('ams-ht', 'AMS HT', '1-slot feeder and dryer', 1);
const AMS_LITE = unit('ams-lite', 'AMS lite', '4-slot feeder', 4);
const MMU3 = unit('mmu3', 'MMU3', '5-slot feeder', 5);
const CFS = unit('cfs', 'CFS', '4-slot feeder', 4);
const ACE_PRO = unit('ace-pro', 'ACE Pro', '4-slot feeder and dryer', 4);

// ---- Shared schedules ------------------------------------------------------

const BANDSAW: ReferenceTask[] = [
  { name: 'Check blade tension and tracking', intervalDays: 30, description: 'Release tension when the saw is not in use. Check guides and thrust bearings.' },
];
const SANDER: ReferenceTask[] = [
  { name: 'Check pad and dust port', intervalDays: 30, description: 'Replace a worn hook-and-loop pad. Clear the dust port and bag.' },
];

export const machines: ReferenceMachine[] = [
  // ---- FFF printers ----------------------------------------------------------------------
  machine({ brand: 'Bambu Lab', model: 'X1 Carbon', machineType: 'printer', summary: 'Enclosed CoreXY (discontinued)', specs: [volume(256, 256, 256)], attachments: [AMS, AMS_2_PRO, AMS_HT] }),
  machine({ brand: 'Bambu Lab', model: 'X1E', machineType: 'printer', summary: 'Enclosed CoreXY, heated chamber (discontinued)', specs: [volume(256, 256, 256)], attachments: [AMS] }),
  machine({ brand: 'Bambu Lab', model: 'P1S', machineType: 'printer', summary: 'Enclosed CoreXY', specs: [volume(256, 256, 256)], attachments: [AMS, AMS_2_PRO, AMS_HT] }),
  machine({ brand: 'Bambu Lab', model: 'P1P', machineType: 'printer', summary: 'Open-frame CoreXY (discontinued)', specs: [volume(256, 256, 256)], attachments: [AMS, AMS_2_PRO, AMS_HT] }),
  machine({ brand: 'Bambu Lab', model: 'P2S', machineType: 'printer', summary: 'Enclosed CoreXY', specs: [volume(256, 256, 256)], attachments: [AMS, AMS_2_PRO, AMS_HT] }),
  machine({ brand: 'Bambu Lab', model: 'A1', machineType: 'printer', summary: 'Bed slinger', specs: [volume(256, 256, 256)], attachments: [AMS_LITE] }),
  machine({ brand: 'Bambu Lab', model: 'A1 mini', machineType: 'printer', summary: 'Compact bed slinger', specs: [volume(180, 180, 180)], attachments: [AMS_LITE] }),
  machine({ brand: 'Bambu Lab', model: 'H2D', machineType: 'printer', summary: 'Dual-nozzle, enclosed', specs: [{ ...volume(325, 320, 325), label: 'Build volume (one nozzle)' }], attachments: [AMS_2_PRO, AMS_HT, AMS] }),
  machine({ brand: 'Bambu Lab', model: 'H2S', machineType: 'printer', summary: 'Large-format, enclosed', specs: [volume(340, 320, 340)], attachments: [AMS_2_PRO, AMS_HT, AMS] }),
  machine({ brand: 'Prusa', model: 'MK4S', machineType: 'printer', summary: 'Bed slinger', specs: [volume(250, 210, 220)], attachments: [MMU3] }),
  machine({ brand: 'Prusa', model: 'CORE One', machineType: 'printer', summary: 'Enclosed CoreXY', specs: [volume(250, 220, 270)], attachments: [MMU3] }),
  machine({ brand: 'Prusa', model: 'MINI+', machineType: 'printer', summary: 'Compact bed slinger', specs: [volume(180, 180, 180)] }),
  machine({ brand: 'Prusa', model: 'XL', machineType: 'printer', summary: 'Large-format tool changer', specs: [volume(360, 360, 360)] }),
  machine({ brand: 'Creality', model: 'Ender-3 V3 SE', machineType: 'printer', summary: 'Bed slinger', specs: [volume(220, 220, 250)] }),
  machine({ brand: 'Creality', model: 'Ender-3 V3', machineType: 'printer', summary: 'CoreXZ', specs: [volume(220, 220, 250)] }),
  machine({ brand: 'Creality', model: 'K1C', machineType: 'printer', summary: 'Enclosed CoreXY', specs: [volume(220, 220, 250)] }),
  machine({ brand: 'Creality', model: 'K1 Max', machineType: 'printer', summary: 'Enclosed CoreXY', specs: [volume(300, 300, 300)] }),
  machine({ brand: 'Creality', model: 'K2 Plus', machineType: 'printer', summary: 'Enclosed CoreXY', specs: [volume(350, 350, 350)], attachments: [CFS] }),
  machine({ brand: 'Elegoo', model: 'Neptune 4 Pro', machineType: 'printer', summary: 'Bed slinger', specs: [volume(225, 225, 265)] }),
  machine({ brand: 'Elegoo', model: 'Neptune 4 Max', machineType: 'printer', summary: 'Large bed slinger', specs: [volume(420, 420, 480)] }),
  machine({ brand: 'Elegoo', model: 'Centauri Carbon', machineType: 'printer', summary: 'Enclosed CoreXY', specs: [volume(256, 256, 256)] }),
  machine({ brand: 'Anycubic', model: 'Kobra 3', machineType: 'printer', summary: 'Bed slinger', specs: [volume(250, 250, 260)], attachments: [ACE_PRO] }),
  machine({ brand: 'Anycubic', model: 'Kobra S1', machineType: 'printer', summary: 'Enclosed CoreXY', specs: [volume(250, 250, 250)], attachments: [ACE_PRO] }),
  machine({ brand: 'Sovol', model: 'SV08', machineType: 'printer', summary: 'Open CoreXY, Voron-style', specs: [volume(350, 350, 345)] }),
  machine({ brand: 'Qidi', model: 'Q1 Pro', machineType: 'printer', summary: 'Enclosed CoreXY, heated chamber (discontinued)', specs: [volume(245, 245, 240)] }),
  machine({ brand: 'Qidi', model: 'Plus4', machineType: 'printer', summary: 'Enclosed CoreXY, heated chamber (discontinued)', specs: [volume(305, 305, 280)] }),
  machine({ brand: 'Voron', model: '2.4 (350)', machineType: 'printer', summary: 'Self-built CoreXY kit', specs: [volume(350, 350, 330)] }),
  machine({ brand: 'Flashforge', model: 'Adventurer 5M', machineType: 'printer', summary: 'Open CoreXY', specs: [volume(220, 220, 220)] }),
  machine({ brand: 'Flashforge', model: 'AD5X', machineType: 'printer', summary: 'CoreXY with 4-colour feeder', specs: [volume(220, 220, 220)], attachments: [unit('ifs', 'IFS', '4-slot feeder', 4)] }),
  machine({ brand: 'UltiMaker', model: 'S5', machineType: 'printer', summary: 'Dual extrusion, professional', specs: [volume(330, 240, 300)] }),
  machine({ brand: 'UltiMaker', model: 'S7', machineType: 'printer', summary: 'Dual extrusion, professional', specs: [volume(330, 240, 300)] }),
  generic('FFF 3D printer', 'printer', { summary: 'Any filament printer not listed' }),

  // ---- Resin printers ---------------------------------------------------------------------
  machine({ brand: 'Elegoo', model: 'Saturn 4 Ultra', machineType: 'resin', summary: 'MSLA', specs: [volume(219, 123, 220)] }),
  machine({ brand: 'Elegoo', model: 'Mars 5 Ultra', machineType: 'resin', summary: 'MSLA', specs: [volume(153, 78, 165)] }),
  machine({ brand: 'Anycubic', model: 'Photon Mono M7 Pro', machineType: 'resin', summary: 'MSLA', specs: [volume(223, 126, 230)] }),
  machine({ brand: 'Formlabs', model: 'Form 4', machineType: 'resin', summary: 'MSLA, professional', specs: [volume(200, 125, 210)] }),
  machine({ brand: 'Prusa', model: 'SL1S Speed', machineType: 'resin', summary: 'MSLA', specs: [volume(127, 80, 150)] }),
  generic('Resin 3D printer', 'resin', { summary: 'Any resin printer not listed' }),

  // ---- Lasers -----------------------------------------------------------------------------
  machine({ brand: 'xTool', model: 'S1 (20 W)', machineType: 'laser', summary: 'Enclosed diode laser', specs: laser(20, 'Diode') }),
  machine({ brand: 'xTool', model: 'S1 (40 W)', machineType: 'laser', summary: 'Enclosed diode laser', specs: [...laser(40, 'Diode'), area(498, 319)] }),
  machine({ brand: 'xTool', model: 'F1', machineType: 'laser', summary: 'Portable galvo, diode and IR', specs: [spec('Laser', '10 W diode + 2 W infrared'), area(115, 115)] }),
  machine({ brand: 'xTool', model: 'P2S', machineType: 'laser', summary: 'Desktop CO2', specs: [...laser(55, 'CO2'), area(600, 305)] }),
  machine({ brand: 'xTool', model: 'M1 Ultra', machineType: 'laser', summary: 'Laser, blade, inkjet and pen', specs: [...laser(20, 'Diode'), area(300, 300)] }),
  machine({ brand: 'Glowforge', model: 'Pro', machineType: 'laser', summary: 'Desktop CO2, pass-through', specs: [...laser(45, 'CO2'), area(495, 279)] }),
  machine({ brand: 'Glowforge', model: 'Plus', machineType: 'laser', summary: 'Desktop CO2', specs: [...laser(40, 'CO2'), area(495, 279)] }),
  machine({ brand: 'Creality', model: 'Falcon2 22W', machineType: 'laser', summary: 'Open-frame diode', specs: [...laser(22, 'Diode'), area(400, 415)] }),
  machine({ brand: 'Sculpfun', model: 'S30 Pro Max', machineType: 'laser', summary: 'Open-frame diode', specs: [...laser(20, 'Diode'), area(370, 360)] }),
  machine({ brand: 'Ortur', model: 'Laser Master 3', machineType: 'laser', summary: 'Open-frame diode', specs: [...laser(10, 'Diode'), area(400, 400)] }),
  machine({ brand: 'OMTech', model: 'Polar Lite 55W', machineType: 'laser', summary: 'Desktop CO2', specs: laser(55, 'CO2') }),
  machine({ brand: 'OMTech', model: 'K40+', machineType: 'laser', summary: 'Entry-level CO2', specs: [spec('Laser type', 'CO2'), area(305, 203)] }),
  machine({ brand: 'Thunder Laser', model: 'Nova 35', machineType: 'laser', summary: 'Workshop CO2', specs: [spec('Laser type', 'CO2'), area(900, 600)] }),
  machine({ brand: 'Trotec', model: 'Speedy 100', machineType: 'laser', summary: 'Professional CO2', specs: [spec('Laser type', 'CO2'), area(610, 305)] }),
  machine({ brand: 'Trotec', model: 'Speedy 400', machineType: 'laser', summary: 'Professional CO2', specs: [spec('Laser type', 'CO2'), area(1016, 610)] }),
  machine({ brand: 'Epilog', model: 'Zing 16', machineType: 'laser', summary: 'Professional CO2 (legacy model)', specs: [spec('Laser type', 'CO2'), area(406, 305)] }),
  machine({ brand: 'Epilog', model: 'Fusion Pro 32', machineType: 'laser', summary: 'Professional CO2 (legacy model)', specs: [spec('Laser type', 'CO2'), area(812, 508)] }),
  machine({ brand: 'HPC Laser', model: 'Laserscript LS3040', machineType: 'laser', summary: 'Desktop CO2', specs: [spec('Laser type', 'CO2'), area(420, 300)] }),
  generic('CO2 laser cutter', 'laser', { summary: 'Any CO2 laser not listed', specs: [spec('Laser type', 'CO2')] }),
  generic('Diode laser engraver', 'laser', { summary: 'Any diode laser not listed', specs: [spec('Laser type', 'Diode')] }),
  generic('Fibre laser marker', 'laser', { summary: 'Galvo fibre laser for metals', specs: [spec('Laser type', 'Fibre')] }),

  // ---- CNC --------------------------------------------------------------------------------
  machine({ brand: 'Carbide 3D', model: 'Shapeoko 5 Pro 4x4', machineType: 'cnc', summary: 'Large-format router', specs: [area(1219, 1219)] }),
  machine({ brand: 'Carbide 3D', model: 'Shapeoko 4 XXL', machineType: 'cnc', summary: 'Router', specs: [area(838, 838, 102)] }),
  machine({ brand: 'Carbide 3D', model: 'Nomad 3', machineType: 'cnc', summary: 'Enclosed desktop mill', specs: [area(203, 203, 76)] }),
  machine({ brand: 'Onefinity', model: 'Machinist', machineType: 'cnc', summary: 'Desktop router', specs: [area(406, 406)] }),
  machine({ brand: 'Onefinity', model: 'Woodworker', machineType: 'cnc', summary: 'Router', specs: [area(816, 816, 133)] }),
  machine({ brand: 'Onefinity', model: 'Journeyman', machineType: 'cnc', summary: 'Large-format router', specs: [area(1222, 816, 133)] }),
  machine({ brand: 'Sienci Labs', model: 'LongMill MK2 30x30', machineType: 'cnc', summary: 'Router (succeeded by the MK2.5)', specs: [area(820, 868)] }),
  machine({ brand: 'Genmitsu', model: '3018-PROVer V2', machineType: 'cnc', summary: 'Entry-level desktop router', specs: [] }),
  machine({ brand: 'Genmitsu', model: '4040-PRO', machineType: 'cnc', summary: 'Desktop router', specs: [] }),
  machine({ brand: 'Makera', model: 'Carvera', machineType: 'cnc', summary: 'Enclosed desktop mill, tool changer', specs: [area(360, 240, 140)], attachments: [unit('atc', 'Automatic tool changer', 'Tool changer', 6, true)] }),
  machine({ brand: 'Makera', model: 'Carvera Air', machineType: 'cnc', summary: 'Enclosed desktop mill, quick tool change', specs: [area(300, 200, 130)] }),
  machine({ brand: 'Ooznest', model: 'WorkBee Z1+ (1000 × 1000)', machineType: 'cnc', summary: 'Router, UK-made', specs: [] }),
  machine({ brand: 'Stepcraft', model: 'D.600', machineType: 'cnc', summary: 'Desktop router', specs: [area(420, 600, 140)] }),
  machine({ brand: 'Roland', model: 'MDX-50', machineType: 'cnc', summary: 'Benchtop mill', specs: [area(400, 305, 135)] }),
  machine({ brand: 'Denford', model: 'Router 2600 Pro', machineType: 'cnc', summary: 'School and workshop router', specs: [area(600, 400, 110)] }),
  generic('CNC router', 'cnc', { summary: 'Any router not listed' }),
  generic('CNC mill', 'cnc', { summary: 'Any milling machine not listed' }),

  // ---- Vinyl and craft cutters -----------------------------------------------------------
  machine({ brand: 'Cricut', model: 'Maker 3', machineType: 'vinyl', summary: 'Craft cutter', specs: [spec('Max material width', '330', 'mm')] }),
  machine({ brand: 'Cricut', model: 'Explore 3', machineType: 'vinyl', summary: 'Craft cutter', specs: [spec('Max material width', '330', 'mm')] }),
  machine({ brand: 'Silhouette', model: 'Cameo 5', machineType: 'vinyl', summary: 'Craft cutter', specs: [spec('Cutting width', '305', 'mm')] }),
  machine({ brand: 'Silhouette', model: 'Portrait 4', machineType: 'vinyl', summary: 'Compact craft cutter', specs: [spec('Cutting width', '216', 'mm')] }),
  machine({ brand: 'Roland', model: 'GS2-24', machineType: 'vinyl', summary: 'Professional vinyl cutter', specs: [spec('Cutting width', '584', 'mm')] }),
  generic('Vinyl cutter', 'vinyl', { summary: 'Any vinyl cutter not listed' }),

  // ---- Finishing equipment ---------------------------------------------------------------
  generic('Random orbital sander, 125 mm', 'finishing', { specs: [spec('Pad', '125', 'mm')], tasks: SANDER }),
  generic('Random orbital sander, 150 mm', 'finishing', { specs: [spec('Pad', '150', 'mm')], tasks: SANDER }),
  generic('Belt and disc sander', 'finishing', { tasks: [{ name: 'Check belt tracking and disc', intervalDays: 30, description: 'Replace a glazed or torn belt or disc. Empty the dust port.' }] }),
  generic('Rotary tool', 'finishing', { summary: 'Hand-held multi-tool for detail sanding and cutting' }),
  generic('Bench grinder and buffer', 'finishing', { tasks: [{ name: 'Dress wheels and check tool rests', intervalDays: 60, description: 'Dress glazed wheels. Set tool rest and spark guard gaps to the maker\'s figures.' }] }),
  generic('Airbrush and compressor', 'finishing', { tasks: [{ name: 'Strip and clean the airbrush', intervalDays: 14, description: 'Strip the needle and nozzle and clean them. Drain the compressor moisture trap.' }] }),
  generic('Spray booth', 'finishing', { tasks: [{ name: 'Replace spray booth filter', intervalDays: 60, description: 'Change the filter when it is visibly loaded or airflow drops.' }] }),
  generic('Vibratory tumbler', 'finishing', { tasks: [{ name: 'Check and refresh media', intervalDays: 60, description: 'Replace worn or contaminated media. Check the bowl for cracks.' }] }),
  generic('Ultrasonic cleaner', 'finishing', { tasks: [{ name: 'Change fluid and clean the tank', intervalDays: 30, description: 'Drain and replace the cleaning fluid. Wipe the tank.' }] }),
  generic('Heat gun', 'finishing'),
  generic('Resin wash station', 'finishing', { summary: 'Agitated wash for resin prints', tasks: [{ name: 'Replace washing alcohol', intervalDays: 30, description: 'Replace when cloudy. Let used alcohol cure in sunlight before disposal.' }] }),
  generic('UV curing station', 'finishing', { summary: 'Post-cure for resin prints' }),

  // ---- Extraction and air -------------------------------------------------------------------
  generic('Laser fume extractor', 'air', { summary: 'Filtered extraction for a laser' }),
  generic('Dust extractor, M-class', 'air', { summary: 'For fine wood and MDF dust' }),
  generic('Workshop vacuum', 'air'),
  generic('Air filtration unit', 'air', { summary: 'Ceiling-hung fine dust filter' }),
  generic('Air compressor', 'air', { tasks: [{ name: 'Drain the tank', intervalDays: 7, description: 'Open the drain valve to release condensed water.' }] }),

  // ---- General workshop -------------------------------------------------------------------
  generic('Pillar drill', 'general', { tasks: [{ name: 'Check belt and chuck', intervalDays: 90, description: 'Check belt tension and wear. Clean the chuck jaws and check for runout.' }] }),
  generic('Bandsaw', 'general', { tasks: BANDSAW }),
  generic('Scroll saw', 'general'),
  generic('Wood lathe', 'general'),
  generic('Metal lathe', 'general', { tasks: [{ name: 'Lubricate ways and leadscrew', intervalDays: 7, description: 'Oil the ways, leadscrew and oil points. Clear swarf first.' }] }),
  generic('Mitre saw', 'general'),
  generic('Table saw', 'general', { tasks: [{ name: 'Check blade, riving knife and guard', intervalDays: 30, description: 'Check blade sharpness, riving knife alignment and that the guard moves freely.' }] }),
  generic('Vacuum former', 'general'),
  generic('Line bender (strip heater)', 'general'),
  generic('Soldering station', 'general', { tasks: [{ name: 'Replace tip and sponge', intervalDays: 90, description: 'Replace a pitted tip. Change the sponge or brass wool.' }] }),

  // ---- Standalone attached hardware --------------------------------------------------------
  generic('Filament dryer, single spool', 'printer', { asUnit: { kind: 'Filament dryer', slots: 1 } }),
  generic('Filament dryer, four spools', 'printer', { asUnit: { kind: 'Filament dryer', slots: 4 } }),
  generic('Dry box (passive storage)', 'printer', { asUnit: { kind: 'Dry box', slots: 4 } }),
];
