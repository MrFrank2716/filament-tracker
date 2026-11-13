import {
  Axe, Battery, Bolt, Box, Boxes, Cable, CircuitBoard, Cog, Component, Cpu, Cylinder, Disc3, Drill, Droplets, Factory,
  Fan, Flame, FlaskConical, Gauge, GraduationCap, Hammer, HardHat, Layers, Lightbulb, Magnet, Microscope, Nut, Package,
  PaintBucket, Paintbrush, Pipette, Plug, Printer, Puzzle, Ruler, Scale, Scissors, Shield, Sparkles, Spool, SprayCan,
  Tag, Thermometer, Truck, Warehouse, Wrench, Zap, type LucideIcon,
} from 'lucide-react';

/**
 * Icons a workspace can assign to its own item types and machine types.
 * Stored by name, so adding one here makes it available everywhere.
 */
export const ICONS: Record<string, LucideIcon> = {
  Package, Spool, Cylinder, Disc3, Drill, Layers, Box, Boxes, Cog, Bolt, Nut, Wrench, Hammer, Axe, SprayCan, Paintbrush,
  PaintBucket, Droplets, Pipette, HardHat, Shield, Printer, Zap, Sparkles, Flame, Fan, Ruler, Scale, Scissors, Gauge,
  Thermometer, Cpu, CircuitBoard, Cable, Plug, Battery, Lightbulb, Magnet, Component, Puzzle, FlaskConical, Microscope,
  GraduationCap, Factory, Warehouse, Truck, Tag,
};

export const ICON_NAMES = Object.keys(ICONS);

export const iconFor = (name: string | null | undefined): LucideIcon => (name && ICONS[name]) || Package;

export const TONES = ['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
export type Tone = (typeof TONES)[number];
export const toneFor = (name: string | null | undefined): Tone => (TONES as readonly string[]).includes(name ?? '') ? (name as Tone) : 'slate';
