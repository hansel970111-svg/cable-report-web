'use client';

import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CableType } from '@/domain/report/model';

const CABLE_TYPES: readonly CableType[] = [
  'Cat 5e',
  'Cat 5e (Vertical Cabling)',
  'LC',
  'MPO',
];

export type ImportPanelProps = {
  file: File | null;
  cableType: CableType;
  site: string;
  startingDateTime: string;
  importing: boolean;
  operationInProgress: boolean;
  onFileChange(file: File | null): void;
  onCableTypeChange(cableType: CableType): void;
  onSiteChange(site: string): void;
  onStartingDateTimeChange(value: string): void;
  onImport(): Promise<void>;
  onCancel(): void;
};

export function ImportPanel({
  file,
  cableType,
  site,
  startingDateTime,
  importing,
  operationInProgress,
  onFileChange,
  onCableTypeChange,
  onSiteChange,
  onStartingDateTimeChange,
  onImport,
  onCancel,
}: ImportPanelProps) {
  return (
    <Card className="report-editor-card">
      <CardHeader>
        <CardTitle>导入 Excel 布线表</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="report-import-form"
          onSubmit={event => {
            event.preventDefault();
            void onImport();
          }}
        >
          <div className="report-field">
            <Label htmlFor="report-site">项目号 (Site)</Label>
            <Input
              id="report-site"
              value={site}
              onChange={event => onSiteChange(event.target.value)}
              placeholder="输入项目号"
              autoComplete="off"
            />
          </div>

          <div className="report-field">
            <Label htmlFor="report-cable-type">线缆类型</Label>
            <select
              id="report-cable-type"
              className="report-native-select"
              value={cableType}
              onChange={event => onCableTypeChange(event.target.value as CableType)}
            >
              {CABLE_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="report-field report-date-time-field">
            <Label>起始测试时间</Label>
            <DateTimePicker
              value={startingDateTime}
              onChange={onStartingDateTimeChange}
              className="report-date-time-picker"
            />
          </div>

          <div className="report-field report-file-field">
            <Label htmlFor="report-excel-file">Excel 布线表</Label>
            <div className="report-file-control">
              <Input
                key={file?.name ?? 'empty-file'}
                id="report-excel-file"
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={event => onFileChange(event.target.files?.[0] ?? null)}
              />
              {file !== null && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="清除 Excel 文件"
                  onClick={() => onFileChange(null)}
                >
                  <X aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>

          <div className="report-import-actions">
            <Button type="submit" disabled={file === null || operationInProgress}>
              加载并导入
            </Button>
            {importing && (
              <>
                <span role="status" aria-label="导入状态">正在导入 Excel…</span>
                <Button type="button" variant="outline" onClick={onCancel}>
                  取消导入
                </Button>
              </>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
