// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';

import type { CableRecord } from '@/domain/report/model';
import { createRecordDraftStore } from './record-draft-store';
import { VirtualRecordTable } from './virtual-record-table';

function makeRecord(index: number): CableRecord {
  const sequence = index + 1;
  return {
    id: `record-${sequence}`,
    cableLabel: `#${sequence}`,
    cableNumber: String(sequence),
    limit: 'TIA - Cat 5e Channel',
    result: 'PASS',
    length: 20,
    nextMargin: 10,
    dateTime: '10-07-2026 09:00:00 AM',
  };
}

describe('VirtualRecordTable', () => {
  it('mounts at most 200 semantic rows for 5,000 accessible records', async () => {
    const records = Array.from({ length: 5_000 }, (_, index) => makeRecord(index));
    const { container } = render(
      <VirtualRecordTable
        records={records}
        draftStore={createRecordDraftStore(records)}
        editing
        viewportHeight={600}
        rowHeight={52}
        overscan={20}
        onDelete={vi.fn()}
      />,
    );

    const table = screen.getByRole('table', { name: '线缆记录预览' });
    expect(table).toHaveAttribute('aria-rowcount', '5001');
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getAllByRole('row').length).toBeLessThanOrEqual(200);
    expect(screen.getByLabelText('第 1 条 Cable Label')).toHaveValue('#1');
    expect(screen.getByRole('button', { name: '删除线缆 #1' })).toBeEnabled();
    expect(container.querySelector('[data-record-id="record-1"]'))
      .toHaveAttribute('aria-rowindex', '2');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('updates only the edited draft and deletes by stable record ID', async () => {
    const user = userEvent.setup();
    const records = [makeRecord(0), makeRecord(1)];
    const draftStore = createRecordDraftStore(records);
    const onDelete = vi.fn();
    render(
      <VirtualRecordTable
        records={records}
        draftStore={draftStore}
        editing
        viewportHeight={200}
        rowHeight={52}
        overscan={2}
        onDelete={onDelete}
      />,
    );

    const input = screen.getByLabelText('第 1 条 Cable Label');
    await user.clear(input);
    await user.type(input, '#100');

    expect(draftStore.get('record-1')).toBe('#100');
    expect(draftStore.get('record-2')).toBe('#2');
    await user.click(screen.getByRole('button', { name: '删除线缆 #100' }));
    expect(onDelete).toHaveBeenCalledWith('record-1');
  });
});
