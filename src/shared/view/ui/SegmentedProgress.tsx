import { cn } from '../../../lib/utils';

type SegmentedProgressProps = {
  done: number;
  total: number;
  /** Steps under way, drawn after the done ones. */
  active?: number;
  /** Fill for done segments; the primary colour when absent. */
  doneClassName?: string;
  className?: string;
};

/** A progress bar cut into one segment per step, so it reads as steps done and left. */
export default function SegmentedProgress({ done, total, active = 0, doneClassName = 'bg-primary', className }: SegmentedProgressProps) {
  return (
    <span aria-hidden="true" className={cn('pointer-events-none flex gap-0.5', className)}>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            'min-w-0 flex-1 transition-colors',
            index < done ? doneClassName : index < done + active ? 'bg-primary/40' : 'bg-muted-foreground/20',
          )}
        />
      ))}
    </span>
  );
}
