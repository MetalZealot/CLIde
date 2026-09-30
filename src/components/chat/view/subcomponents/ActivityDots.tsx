import { useLayoutEffect, useRef } from 'react';

export type ActivityDotState =
  | 'starting'
  | 'thinking'
  | 'working'
  | 'waiting'
  | 'retrying'
  | 'compacting'
  | 'done'
  | 'failed';

/** One dot: x and y offset from the centre (em), scale, opacity. */
type DotPose = [number, number, number, number];

const TAU = Math.PI * 2;
const BLEND_S = 0.5;
const STAGGER_S = 0.06;
const rowX = (i: number) => (i - 1) * 0.3;
const shake = (age: number) => 0.1 * Math.exp(-age * 4) * Math.sin(age * 38);

// t is a shared clock so every copy stays in phase; age is seconds since this state began.
const POSES: Record<ActivityDotState, (t: number, age: number, i: number) => DotPose> = {
  starting: (t, _age, i) => [rowX(i), 0, 0.85, 0.3 + 0.7 * Math.max(0, Math.sin(TAU * (t / 1.5 - i * 0.13)))],
  thinking: (t, _age, i) => {
    const angle = TAU * (t / 2.8 + i / 3) - Math.PI / 2;
    const wave = Math.sin(TAU * t / 1.4 + i * 2.1);
    const radius = 0.25 + 0.07 * wave;
    return [radius * Math.cos(angle), radius * Math.sin(angle), 0.95 + 0.12 * wave, 1];
  },
  working: (t, _age, i) => {
    const bounce = Math.max(0, Math.sin(TAU * (t / 0.9 - i * 0.14)));
    return [rowX(i), -0.2 * bounce, 1 + 0.08 * bounce, 1];
  },
  waiting: (t, _age, i) => [rowX(i), 0, 1, i === 1 ? 0.65 + 0.35 * Math.cos(TAU * t / 1.6) : 0.35],
  retrying: (_t, age, i) => {
    const phase = (((age - i * 0.03) % 1.8) + 1.8) % 1.8 / 1.8;
    const hitch = phase < 0.5 ? Math.sin(phase / 0.25 * TAU) * Math.sin(phase / 0.5 * Math.PI) : 0;
    return [rowX(i) + 0.09 * hitch, 0, 1, 1];
  },
  compacting: (t, _age, i) => {
    const spread = (1 + Math.cos(TAU * t / 1.6)) / 2;
    return [(i - 1) * (0.22 + 0.1 * spread), 0, i === 1 ? 1 + 0.25 * (1 - spread) : 1, 1];
  },
  done: (_t, age) => [0, 0, 1.35 + Math.exp(-age * 5) * Math.sin(age * 18) * 0.35, 1],
  failed: (_t, age, i) => {
    const slump = age > 0.45 ? 0.12 * (1 - Math.exp(-(age - 0.45) * 8)) : 0;
    return [rowX(i) + shake(age), slump, 1 - slump, 1];
  },
};

const COLOR: Record<ActivityDotState, string> = {
  starting: 'text-primary',
  thinking: 'text-primary',
  working: 'text-primary',
  compacting: 'text-primary',
  waiting: 'text-amber-600 dark:text-amber-400',
  retrying: 'text-muted-foreground',
  done: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400',
};

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const posesAt = (state: ActivityDotState, t: number, age: number): DotPose[] => [0, 1, 2].map((i) => POSES[state](t, age, i));
// Reduced motion shows each state's settled frame.
const stillPoses = (state: ActivityDotState) => posesAt(state, 0, 1);

type Motion = { state: ActivityDotState; enteredAt: number; from: DotPose[] | null; current: DotPose[] | null };

/**
 * Three dots whose arrangement names the turn's state. A state change carries the
 * dots from where they are into the next arrangement instead of swapping.
 */
export default function ActivityDots({ state }: { state: ActivityDotState }) {
  const dotRefs = useRef<Array<HTMLElement | null>>([]);
  const motionRef = useRef<Motion | null>(null);

  // Layout effect so the first frame already shows the arrangement, not three stacked dots.
  useLayoutEffect(() => {
    const paint = (poses: DotPose[]) => {
      poses.forEach(([x, y, scale, opacity], i) => {
        const dot = dotRefs.current[i];
        if (!dot) return;
        dot.style.transform = `translate(${x.toFixed(4)}em, ${y.toFixed(4)}em) scale(${scale.toFixed(4)})`;
        dot.style.opacity = opacity.toFixed(3);
      });
    };

    const now = performance.now() / 1000;
    const motion = motionRef.current;
    if (!motion) {
      const first = posesAt(state, now, 0);
      motionRef.current = { state, enteredAt: now, from: null, current: first };
      paint(first);
    } else if (motion.state !== state) {
      motion.from = motion.current;
      motion.state = state;
      motion.enteredAt = now;
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || typeof requestAnimationFrame !== 'function') {
      const still = stillPoses(state);
      motionRef.current = { state, enteredAt: now, from: null, current: still };
      paint(still);
      return undefined;
    }

    let frame = 0;
    const tick = (ms: number) => {
      const current = motionRef.current;
      if (!current) return;
      const t = ms / 1000;
      const age = t - current.enteredAt;
      const target = posesAt(current.state, t, age);
      const { from } = current;
      const poses = from
        ? target.map((pose, i) => {
          const progress = easeInOutCubic(Math.min(1, Math.max(0, (age - i * STAGGER_S) / BLEND_S)));
          return pose.map((value, k) => from[i][k] + (value - from[i][k]) * progress) as DotPose;
        })
        : target;
      current.current = poses;
      paint(poses);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state]);

  return (
    <span
      className={`relative inline-block h-[1em] w-[1em] shrink-0 text-[18px] transition-colors duration-300 ${COLOR[state]}`}
      data-state={state}
      aria-hidden
    >
      {[0, 1, 2].map((i) => (
        <i
          key={i}
          ref={(node) => { dotRefs.current[i] = node; }}
          className="absolute left-1/2 top-1/2 -ml-[0.11em] -mt-[0.11em] h-[0.22em] w-[0.22em] rounded-full bg-current"
        />
      ))}
    </span>
  );
}
