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

/** One dot: x and y offset from the centre (em), scale, opacity, depth (-1 far to 1 near). */
type DotPose = [number, number, number, number, number];

const TAU = Math.PI * 2;
const BLEND_S = 0.5;
const STAGGER_S = 0.06;
const BRAID_STEP_S = 0.62;
const BRAID_CROSS_S = 0.46;
const rowX = (i: number) => (i - 1) * 0.3;
const shake = (age: number) => 0.1 * Math.exp(-age * 4) * Math.sin(age * 38);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOutSine = (x: number) => (1 - Math.cos(Math.PI * x)) / 2;

// t is a shared clock so every copy stays in phase; age is seconds since this state began.
const POSES: Record<ActivityDotState, (t: number, age: number, i: number) => DotPose> = {
  starting: (t, _age, i) => [rowX(i), 0, 0.85, 0.3 + 0.7 * Math.max(0, Math.sin(TAU * (t / 1.5 - i * 0.13))), 0],
  // A tilted ring, turning clockwise, whose tilt slowly precesses; near dots grow and brighten.
  thinking: (t, _age, i) => {
    const angle = TAU * (t / 2.4 + i / 3);
    const tilt = 1.05 + 0.2 * Math.sin(TAU * t / 5);
    const turn = TAU * t / 7;
    const x = 0.28 * Math.cos(angle);
    const y = 0.28 * Math.sin(angle) * Math.cos(tilt);
    const z = Math.sin(angle) * Math.sin(tilt);
    return [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn), 1 + 0.16 * z, 0.81 + 0.19 * z, z];
  },
  // Outer dots take turns crossing over the middle one; the order repeats every six crossings.
  working: (t, _age, i) => {
    const step = Math.floor(t / BRAID_STEP_S);
    const slots = [0, 1, 2];
    for (let k = 0; k < step % 6; k++) {
      const [a, b] = k % 2 ? [1, 2] : [0, 1];
      for (let d = 0; d < 3; d++) slots[d] = slots[d] === a ? b : slots[d] === b ? a : slots[d];
    }
    const [left, right] = step % 2 ? [1, 2] : [0, 1];
    const slot = slots[i];
    if (slot !== left && slot !== right) return [rowX(slot), 0, 1, 1, 0];
    const progress = easeInOutSine(clamp01((t - step * BRAID_STEP_S) / BRAID_CROSS_S));
    const target = slot === left ? right : left;
    const z = (slot === (step % 2 ? right : left) ? 1 : -1) * Math.sin(Math.PI * progress);
    return [rowX(slot) + (rowX(target) - rowX(slot)) * progress, 0.07 * z, 1 + 0.16 * z, z < 0 ? 1 + 0.38 * z : 1, z];
  },
  waiting: (t, _age, i) => [rowX(i), 0, 1, i === 1 ? 0.65 + 0.35 * Math.cos(TAU * t / 1.6) : 0.35, 0],
  retrying: (_t, age, i) => {
    const phase = (((age - i * 0.03) % 1.8) + 1.8) % 1.8 / 1.8;
    const hitch = phase < 0.5 ? Math.sin(phase / 0.25 * TAU) * Math.sin(phase / 0.5 * Math.PI) : 0;
    return [rowX(i) + 0.09 * hitch, 0, 1, 1, 0];
  },
  compacting: (t, _age, i) => {
    const spread = (1 + Math.cos(TAU * t / 1.6)) / 2;
    return [(i - 1) * (0.22 + 0.1 * spread), 0, i === 1 ? 1 + 0.25 * (1 - spread) : 1, 1, 0];
  },
  done: (_t, age) => [0, 0, 1.35 + Math.exp(-age * 5) * Math.sin(age * 18) * 0.35, 1, 0],
  failed: (_t, age, i) => {
    const slump = age > 0.45 ? 0.12 * (1 - Math.exp(-(age - 0.45) * 8)) : 0;
    return [rowX(i) + shake(age), slump, 1 - slump, 1, 0];
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
      poses.forEach(([x, y, scale, opacity, z], i) => {
        const dot = dotRefs.current[i];
        if (!dot) return;
        dot.style.transform = `translate(${x.toFixed(4)}em, ${y.toFixed(4)}em) scale(${scale.toFixed(4)})`;
        dot.style.opacity = opacity.toFixed(3);
        dot.style.zIndex = String(Math.round((z + 1) * 50));
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
      className={`relative isolate inline-block h-[1em] w-[1em] shrink-0 text-[18px] transition-colors duration-300 ${COLOR[state]}`}
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
