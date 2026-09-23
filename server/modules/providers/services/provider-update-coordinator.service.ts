import type { LLMProvider } from '@/shared/types.js';

type ProviderActivity = {
  count: number;
  updating: boolean;
  idle: Set<() => void>;
  cancel?: () => void;
};

/** Serializes explicit CLI updates against Chat, jobs, and provider Shells. */
export class ProviderUpdateCoordinator {
  private readonly activity = new Map<LLMProvider, ProviderActivity>();

  private state(provider: LLMProvider): ProviderActivity {
    let state = this.activity.get(provider);
    if (!state) {
      state = { count: 0, updating: false, idle: new Set() };
      this.activity.set(provider, state);
    }
    return state;
  }

  acquire(provider: LLMProvider): () => void {
    const state = this.state(provider);
    if (state.updating) throw new Error('A CLI update is pending. Wait for it to finish before starting more work.');
    state.count += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.count -= 1;
      if (state.count === 0) {
        for (const resolve of state.idle) resolve();
        state.idle.clear();
      }
    };
  }

  async run<T>(provider: LLMProvider, operation: () => Promise<T>): Promise<T> {
    const release = this.acquire(provider);
    try { return await operation(); } finally { release(); }
  }

  async update<T>(provider: LLMProvider, operation: () => Promise<T>): Promise<T> {
    const state = this.state(provider);
    if (state.updating) throw new Error('A CLI update is already pending.');
    state.updating = true;
    try {
      if (state.count > 0) await new Promise<void>((resolve, reject) => {
        const ready = () => { state.cancel = undefined; resolve(); };
        state.idle.add(ready);
        state.cancel = () => {
          state.idle.delete(ready);
          reject(new DOMException('CLI update cancelled.', 'AbortError'));
        };
      });
      return await operation();
    } finally {
      state.cancel = undefined;
      state.updating = false;
    }
  }

  cancelWaiting(provider: LLMProvider): boolean {
    const cancel = this.state(provider).cancel;
    if (!cancel) return false;
    cancel();
    return true;
  }
}

/** Shared by provider execution and the explicit update service. */
export const providerUpdateCoordinator = new ProviderUpdateCoordinator();
