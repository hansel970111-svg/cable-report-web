import type { CableRecord } from '@/domain/report/model';

export interface RecordDraftStore {
  get(id: string): string | undefined;
  set(id: string, value: string): void;
  subscribe(id: string, listener: () => void): () => void;
  snapshot(): ReadonlyMap<string, string>;
  reset(records: readonly CableRecord[]): void;
  clear(): void;
}

export function createRecordDraftStore(
  initialRecords: readonly CableRecord[] = [],
): RecordDraftStore {
  let drafts = new Map(
    initialRecords.map(record => [record.id, record.cableLabel] as const),
  );
  const listeners = new Map<string, Set<() => void>>();

  const notify = (id: string) => {
    listeners.get(id)?.forEach(listener => listener());
  };

  return {
    get(id) {
      return drafts.get(id);
    },
    set(id, value) {
      if (drafts.get(id) === value && drafts.has(id)) return;
      drafts.set(id, value);
      notify(id);
    },
    subscribe(id, listener) {
      const recordListeners = listeners.get(id) ?? new Set();
      recordListeners.add(listener);
      listeners.set(id, recordListeners);
      return () => {
        recordListeners.delete(listener);
        if (recordListeners.size === 0) listeners.delete(id);
      };
    },
    snapshot() {
      return new Map(drafts);
    },
    reset(records) {
      const nextDrafts = new Map(
        records.map(record => [record.id, record.cableLabel] as const),
      );
      const previousDrafts = drafts;
      const affectedIds = new Set([...previousDrafts.keys(), ...nextDrafts.keys()]);
      drafts = nextDrafts;
      affectedIds.forEach(id => {
        const existedBefore = previousDrafts.has(id);
        const existsNow = nextDrafts.has(id);
        if (existedBefore !== existsNow
            || previousDrafts.get(id) !== nextDrafts.get(id)) notify(id);
      });
    },
    clear() {
      const affectedIds = [...drafts.keys()];
      drafts = new Map();
      affectedIds.forEach(notify);
    },
  };
}
