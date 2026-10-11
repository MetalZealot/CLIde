import type { ProbeDefinition } from './types';

// Probes are untracked files beside the harness; the example ships with it.
const modules = import.meta.glob<{ default: ProbeDefinition }>(
  ['../*.probe.tsx', './example.probe.tsx'],
  { eager: true },
);

export type RegisteredProbe = { name: string; probe: ProbeDefinition };

export const PROBES: RegisteredProbe[] = Object.entries(modules)
  .map(([path, module]) => ({
    name: path.split('/').pop()!.replace(/\.probe\.tsx$/, ''),
    probe: module.default,
  }))
  .sort((a, b) => b.probe.date.localeCompare(a.probe.date) || a.name.localeCompare(b.name));

export function findProbe(name: string | null): RegisteredProbe | undefined {
  return name ? PROBES.find((entry) => entry.name === name) : undefined;
}
