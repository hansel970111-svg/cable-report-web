'use client';

import {
  memo,
  useCallback,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Trash2 } from 'lucide-react';

import type { CableRecord } from '@/domain/report/model';
import type { RecordDraftStore } from './record-draft-store';

export type VirtualRecordTableProps = {
  records: readonly CableRecord[];
  draftStore: RecordDraftStore;
  editing: boolean;
  viewportHeight?: number;
  rowHeight?: number;
  overscan?: number;
  onDelete(id: string): void;
};

type VirtualRecordRowProps = {
  record: CableRecord;
  recordIndex: number;
  start: number;
  size: number;
  draftStore: RecordDraftStore;
  editing: boolean;
  onDelete(id: string): void;
};

const VirtualRecordRow = memo(function VirtualRecordRow({
  record,
  recordIndex,
  start,
  size,
  draftStore,
  editing,
  onDelete,
}: VirtualRecordRowProps) {
  const subscribe = useCallback(
    (listener: () => void) => draftStore.subscribe(record.id, listener),
    [draftStore, record.id],
  );
  const getSnapshot = useCallback(
    () => draftStore.get(record.id) ?? record.cableLabel,
    [draftStore, record.cableLabel, record.id],
  );
  const cableLabel = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const inputId = `cable-label-${record.id}`;

  return (
    <div
      role="row"
      aria-rowindex={recordIndex + 2}
      data-record-id={record.id}
      className="virtual-record-grid virtual-record-row"
      style={{
        height: `${size}px`,
        transform: `translateY(${start}px)`,
      }}
    >
      <div role="cell" className="record-sequence">
        {recordIndex + 1}
      </div>
      <div role="cell" className="record-label-cell">
        {editing ? (
          <>
            <label htmlFor={inputId} className="sr-only">
              {`第 ${recordIndex + 1} 条 Cable Label`}
            </label>
            <input
              id={inputId}
              className="record-label-input"
              value={cableLabel}
              onChange={event => draftStore.set(record.id, event.target.value)}
            />
          </>
        ) : (
          <span className="record-label-text">{record.cableLabel}</span>
        )}
      </div>
      <div role="cell" className="record-secondary record-limit">
        {record.limit}
      </div>
      <div role="cell" className="record-secondary">
        {record.result}
      </div>
      <div role="cell" className="record-secondary record-number">
        {record.length.toFixed(1)} m
      </div>
      <div role="cell" className="record-secondary record-number">
        {record.nextMargin.toFixed(1)} dB
      </div>
      <div role="cell" className="record-time">
        {record.dateTime}
      </div>
      <div role="cell" className="record-action">
        <button
          type="button"
          className="record-delete-button"
          aria-label={`删除线缆 ${cableLabel}`}
          onClick={() => onDelete(record.id)}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

export function VirtualRecordTable({
  records,
  draftStore,
  editing,
  viewportHeight = 560,
  rowHeight = 52,
  overscan = 20,
  onDelete,
}: VirtualRecordTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual intentionally exposes a mutable virtualizer instance.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan,
    getItemKey: index => records[index].id,
    initialRect: { width: 1024, height: viewportHeight },
    observeElementRect: (instance, callback) => {
      const element = instance.scrollElement;
      if (!element) return;
      const measure = () => callback({
        width: element.clientWidth || 1024,
        height: element.clientHeight || viewportHeight,
      });
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    },
  });

  return (
    <div
      role="table"
      aria-label="线缆记录预览"
      aria-colcount={8}
      aria-rowcount={records.length + 1}
      className="virtual-record-table"
    >
      <div role="rowgroup" className="virtual-record-header-group">
        <div role="row" aria-rowindex={1} className="virtual-record-grid virtual-record-header">
          <div role="columnheader">序号</div>
          <div role="columnheader">Cable Label</div>
          <div role="columnheader" className="record-secondary">标准</div>
          <div role="columnheader" className="record-secondary">结果</div>
          <div role="columnheader" className="record-secondary">长度</div>
          <div role="columnheader" className="record-secondary">余量</div>
          <div role="columnheader">测试时间</div>
          <div role="columnheader">操作</div>
        </div>
      </div>
      <div
        ref={scrollRef}
        role="rowgroup"
        className="virtual-record-viewport"
        data-virtual-record-viewport="true"
        style={{ height: `${viewportHeight}px` }}
      >
        <div
          role="presentation"
          className="virtual-record-spacer"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map(virtualRow => {
            const record = records[virtualRow.index];
            return (
              <VirtualRecordRow
                key={record.id}
                record={record}
                recordIndex={virtualRow.index}
                start={virtualRow.start}
                size={virtualRow.size}
                draftStore={draftStore}
                editing={editing}
                onDelete={onDelete}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
