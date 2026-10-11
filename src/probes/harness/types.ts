import type { ReactNode } from 'react';

import type { AppTab } from '../../types/app';

export type ProbeOption = {
  /** Button text, kept to a word or two. */
  label: string;
  /** One sentence shown under the buttons while this option is picked. */
  meaning: string;
};

/** One question the probe asks, answered by picking one of its options. */
export type ProbeAxis = {
  label: string;
  options: Record<string, ProbeOption>;
};

export type ProbeSelection<Axes extends Record<string, ProbeAxis>> = {
  [K in keyof Axes]: keyof Axes[K]['options'] & string;
};

export type ProbeFrameOptions = {
  /** Tab the bottom nav shows as active. */
  tab?: AppTab;
  /** Header title; the frame's fake session summary when absent. */
  sessionTitle?: string;
  /** Leave the real header, composer or bottom nav out, for probes that replace them. */
  hideHeader?: boolean;
  hideComposer?: boolean;
  hideNav?: boolean;
};

export type ProbeDefinition<Axes extends Record<string, ProbeAxis> = Record<string, ProbeAxis>> = {
  title: string;
  /** ISO date the probe was made; the index lists newest first. */
  date: string;
  /** The decision the probe exists to settle, in one line. */
  question: string;
  axes: Axes;
  frame?: ProbeFrameOptions;
  /** Draws the content between the header and the bottom nav. */
  render: (selection: ProbeSelection<Axes>) => ReactNode;
};

/** Identity helper so a probe file gets its selection typed from its own axes. */
export function defineProbe<Axes extends Record<string, ProbeAxis>>(probe: ProbeDefinition<Axes>) {
  return probe;
}
