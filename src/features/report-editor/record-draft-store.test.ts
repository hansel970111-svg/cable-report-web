import { describe, expect, it, vi } from 'vitest';

import type { CableRecord } from '@/domain/report/model';
import { createRecordDraftStore } from './record-draft-store';

function makeRecord(id: string, cableLabel: string): CableRecord {
  return {
    id,
    cableLabel,
    cableNumber: cableLabel.replace(/^#/, ''),
    limit: 'TIA - Cat 5e Channel',
    result: 'PASS',
    length: 20,
    nextMargin: 10,
    dateTime: '10-07-2026 09:00:00 AM',
  };
}

describe('createRecordDraftStore', () => {
  it('stores labels by stable record ID and returns an isolated batch snapshot', () => {
    const store = createRecordDraftStore([
      makeRecord('record-1', '#1'),
      makeRecord('record-2', '#2'),
    ]);

    expect(store.get('record-1')).toBe('#1');
    store.set('record-1', '#100');

    const snapshot = store.snapshot();
    expect(snapshot).toEqual(new Map([
      ['record-1', '#100'],
      ['record-2', '#2'],
    ]));

    store.set('record-1', '#101');
    expect(snapshot.get('record-1')).toBe('#100');
  });

  it('notifies only listeners for the changed ID and skips no-op writes', () => {
    const store = createRecordDraftStore([
      makeRecord('record-1', '#1'),
      makeRecord('record-2', '#2'),
    ]);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = store.subscribe('record-1', first);
    store.subscribe('record-2', second);

    store.set('record-1', '#10');
    store.set('record-1', '#10');

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();

    unsubscribe();
    store.set('record-1', '#11');
    expect(first).toHaveBeenCalledOnce();
  });

  it('resets and clears drafts while notifying only affected IDs', () => {
    const store = createRecordDraftStore([
      makeRecord('record-1', '#1'),
      makeRecord('record-2', '#2'),
    ]);
    const first = vi.fn();
    const second = vi.fn();
    store.subscribe('record-1', first);
    store.subscribe('record-2', second);

    store.reset([
      makeRecord('record-1', '#1'),
      makeRecord('record-2', '#20'),
    ]);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    store.clear();
    expect(store.snapshot()).toEqual(new Map());
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
  });
});
