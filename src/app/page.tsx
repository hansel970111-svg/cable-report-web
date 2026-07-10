'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DateTimePicker, generateDecreasingTimes } from '@/components/ui/date-time-picker';
import { defaultLimitForCableType } from '@/domain/report/cable-rules';
import type { CableImportRow, CableType as ReportCableType } from '@/domain/report/model';
import { mathRandomSource } from '@/domain/report/random-source';
import { defaultRecordIdFactory, mapImportedRows } from '@/domain/report/record-mapper';
import {
  ensureUiRecordIds,
  toUiCableRecords,
  type UiCableRecord as CableRecord,
} from '@/lib/reportRecordAdapter';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Upload, 
  Download, 
  Edit2, 
  Save, 
  X, 
  Loader2, 
  FileText,
  Clock,
  CheckCircle,
  Trash2
} from 'lucide-react';
import { 
  isValidWorkingTime, 
  getDefaultStartingDateTime,
  TIME_RANGES 
} from '@/lib/timeUtils';

interface ParsedData {
  site: string;
  records: CableRecord[];
  page_count: number;
  cableType?: string;
  dataSource?: string;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function readApiError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const body = await response.json();
      if (typeof body?.error === 'string' && body.error.trim()) {
        return body.error;
      }
    } catch {
      // Fall through to text handling below.
    }
  }

  const text = await response.text();
  const isHtmlError = /^\s*<!doctype html/i.test(text) || /<html[\s>]/i.test(text);
  if (isHtmlError) {
    if (response.status === 502 || /<title>\s*502\s*<\/title>/i.test(text)) {
      return '服务器生成 PDF 超时或临时不可用，请稍后重试。';
    }
    return `服务器返回了异常页面（HTTP ${response.status}）。`;
  }

  return text.trim() || `请求失败（HTTP ${response.status}）`;
}

export default function Home() {
  const [cableType, setCableType] = useState<string>('Cat 5e');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [editingRecords, setEditingRecords] = useState<Set<number>>(new Set());
  const [tempValues, setTempValues] = useState<Record<number, { cable_label: string }>>({});
  const [loading, setLoading] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const [startingDateTime, setStartingDateTime] = useState<string>(getDefaultStartingDateTime());
  const [modificationStatus, setModificationStatus] = useState<'idle' | 'ready' | 'modified'>('idle');
  const [excelInfo, setExcelInfo] = useState<{
    sheetName: string;
    detectedColumns: Record<string, string | null | undefined>;
    totalCount: number;
  } | null>(null);
  // 用于在Excel上传时访问模板数据（setState是异步的，所以使用ref）
  const templateDataRef = useRef<ParsedData | null>(null);
  const importRequestIdRef = useRef(0);
  const [siteNumber, setSiteNumber] = useState<string>(''); // 项目号输入
  const [fileInputKey, setFileInputKey] = useState<number>(0); // 用于强制刷新文件选择器

  const resetImportedData = () => {
    importRequestIdRef.current += 1;
    templateDataRef.current = null;
    setParsedData(null);
    setExcelInfo(null);
    setEditingRecords(new Set());
    setTempValues({});
    setModificationStatus('idle');
  };

  // 监控parsedData变化，确保数据完整性
  useEffect(() => {
    if (parsedData && parsedData.records.length > 0) {
      console.log(`[parsedData监控] records数量: ${parsedData.records.length}, 首条: ${parsedData.records[0]?.cable_label}, 末条: ${parsedData.records[parsedData.records.length - 1]?.cable_label}`);
    }
  }, [parsedData]);

  // 文件选择处理
  const handleExcelFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setExcelFile(selectedFile);
      resetImportedData();
    }
  };

  // 清除选中的文件
  const handleClearFile = () => {
    setExcelFile(null);
    resetImportedData();
    setFileInputKey(prev => prev + 1); // 强制刷新文件选择器
  };

  const handleCableTypeChange = (value: string) => {
    if (value === cableType) return;
    setCableType(value);
    resetImportedData();
  };

  const handleBatchEdit = () => {
    if (!parsedData) return;

    const newTempValues: Record<number, { cable_label: string }> = {};
    const newEditingRecords = new Set<number>();

    parsedData.records.forEach((record, index) => {
      newTempValues[index] = {
        cable_label: record.cable_label,
      };
      newEditingRecords.add(index);
    });

    setTempValues(newTempValues);
    setEditingRecords(newEditingRecords);
  };

  const handleDeleteRecord = (index: number) => {
    if (!parsedData) return;

    setParsedData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        records: prev.records.filter((_, i) => i !== index),
      };
    });
  };

  const handleBatchSave = () => {
    if (!parsedData || Object.keys(tempValues).length === 0) return;

    setParsedData(prev => {
      if (!prev) return prev;
      const newRecords = prev.records.map((record, index) => {
        const tempValue = tempValues[index];
        if (!tempValue) return record;

        return {
          ...record,
          cable_label: tempValue.cable_label,
          cable_number: tempValue.cable_label.replace('#', ''),
        };
      });
      return { ...prev, records: newRecords };
    });

    setEditingRecords(new Set());
    setTempValues({});
  };

  const handleBatchCancel = () => {
    setEditingRecords(new Set());
    setTempValues({});
  };

  const handleModifyPDF = async () => {
    if (!parsedData) return;

    if (parsedData.cableType && parsedData.cableType !== cableType) {
      alert(`当前预览数据属于 ${parsedData.cableType}，但你现在选择的是 ${cableType}。请重新点击“加载并导入”后再生成测试报告。`);
      return;
    }

    // 数据验证：检查必需字段
    const invalidRecords: number[] = [];
    parsedData.records.forEach((record, index) => {
      if (!record.cable_label || !record.date_time ||
          record.length === undefined || record.next_margin === undefined) {
        invalidRecords.push(index + 1);
      }
    });

    if (invalidRecords.length > 0) {
      alert(`数据验证失败：以下记录缺少必需字段 - ${invalidRecords.join(', ')}`);
      return;
    }

    // 如果有Excel数据，验证线号和线长是否匹配
    if (excelInfo && excelInfo.totalCount > 0) {
      if (parsedData.records.length !== excelInfo.totalCount) {
        const confirm = window.confirm(
          `警告：记录数量不匹配！\n` +
          `Excel导入: ${excelInfo.totalCount} 条\n` +
          `当前PDF: ${parsedData.records.length} 条\n\n` +
          `是否继续生成PDF？`
        );
        if (!confirm) return;
      }
    }

    // 直接生成PDF，无需二次确认
    console.log(`开始生成PDF: 共 ${parsedData.records.length} 条记录`);

    setLoading(true);
    try {
      // 使用预览表格中已经保存的时间，确保所有线缆类型生成的PDF与预览一致
      const modifications = {
        cableType,
        site: siteNumber || parsedData.site,  // 优先使用用户输入的项目号
        records: parsedData.records.map((record) => ({
          cable_label: record.cable_label,
          limit: (cableType === 'MPO' && (!record.limit || record.limit.includes('Cat 5e')))
            ? defaultLimitForCableType(cableType as ReportCableType)
            : record.limit || defaultLimitForCableType(cableType as ReportCableType),
          result: record.result || 'PASS',
          date_time: record.date_time,
          length: record.length,
          next_margin: record.next_margin,
        }))
      };

      const response = await fetchWithTimeout('/api/modify-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(modifications),
      }, 180000);

      if (!response.ok) {
        const errorMessage = await readApiError(response);
        console.error('API Error:', errorMessage);
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // 从响应头获取文件名
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'cable_test_report.pdf'; // 默认文件名
      
      if (contentDisposition) {
        // 解析 Content-Disposition 头
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
        if (matches && matches[1]) {
          // 移除引号
          filename = matches[1].replace(/['"]/g, '');
        }
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      setModificationStatus('modified');
    } catch (error) {
      console.error('Modify error:', error);
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? 'PDF生成时间过长，请减少数据量或稍后重试。'
        : (error as Error).message;
      alert('PDF修改失败: ' + message);
    } finally {
      setLoading(false);
    }
  };

  const handleTempValueChange = (index: number, field: 'cable_label', value: string) => {
    setTempValues(prev => ({
      ...prev,
      [index]: {
        ...prev[index],
        [field]: value,
      },
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-slate-800 dark:text-white mb-2">
            线缆测试报告编辑器
          </h1>
        </div>

        {/* Status Banner */}
        {modificationStatus === 'modified' && (
          <Card className="mb-6 border-green-500 bg-green-50 dark:bg-green-900/20">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">PDF已成功修改并下载！原始格式完全保留。</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upload Section */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              导入Excel布线表
            </CardTitle>

          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-4 gap-4">
              {/* 项目号输入 */}
              <div className="space-y-2">
                <Label>项目号 (Site)</Label>
                <Input
                  type="text"
                  value={siteNumber}
                  onChange={(e) => {
                    setSiteNumber(e.target.value);
                    // 同时更新parsedData中的site
                    if (parsedData) {
                      setParsedData(prev => {
                        if (!prev) return prev;
                        return { ...prev, site: e.target.value };
                      });
                    }
                  }}
                  placeholder="输入项目号"
                  className="cursor-pointer"
                />
              </div>

              {/* 线缆类型选择 */}
              <div className="space-y-2">
                <Label>线缆类型</Label>
                <Select value={cableType} onValueChange={handleCableTypeChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择线缆类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cat 5e">Cat 5e</SelectItem>
                    <SelectItem value="Cat 5e (Vertical Cabling)">Cat 5e (Vertical Cabling)</SelectItem>
                    <SelectItem value="LC">LC</SelectItem>
                    <SelectItem value="MPO">MPO</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Excel文件选择 */}
              <div className="space-y-2">
                <Label>Excel布线表</Label>
                <div className="flex gap-2">
                  <Input
                    key={fileInputKey}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleExcelFileChange}
                    className="cursor-pointer flex-1"
                  />
                  {excelFile && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleClearFile}
                      className="shrink-0"
                      title="清除文件"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                {/* 显示选中的文件名 */}
                {excelFile && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 p-2 rounded">
                    <FileText className="w-4 h-4 shrink-0" />
                    <span className="truncate font-medium">{excelFile.name}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-500 shrink-0">
                      ({(excelFile.size / 1024).toFixed(2)} KB)
                    </span>
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="space-y-2">
                {/* 调试状态 */}
                <div className="text-xs text-slate-500 flex gap-4">
                  <span>文件: {excelFile ? '✓' : '✗'}</span>
                  <span>模板: {loadingTemplate ? '加载中' : '✓'}</span>
                  <span>上传: {uploadingExcel ? '上传中' : '✓'}</span>
                </div>
                <Button
                  onClick={async () => {
                    console.log('按钮点击', { excelFile: !!excelFile, loadingTemplate, uploadingExcel });
                    if (!excelFile) {
                      alert('请先选择Excel文件');
                      return;
                    }

                    const requestId = importRequestIdRef.current + 1;
                    importRequestIdRef.current = requestId;
                    const selectedCableType = cableType;
                    const selectedExcelFile = excelFile;

                    // 先加载模板
                    setLoadingTemplate(true);
                    console.log('开始加载模板, cableType:', selectedCableType);
                    try {
                      const templateResponse = await fetchWithTimeout('/api/load-template', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ cableType: selectedCableType }),
                      }, 60000);

                      console.log('模板API响应状态:', templateResponse.status);
                      const templateResult = await templateResponse.json();
                      console.log('模板API响应:', templateResult);

                      if (templateResult.success) {
                        if (requestId !== importRequestIdRef.current) return;

                        // 保存模板数据到state，供后续Excel导入时使用
                        if (templateResult.data && templateResult.data.records) {
                          console.log('[模板加载] 保存模板数据到state，records数量:', templateResult.data.records.length);
                          if (templateResult.data.records.length > 0) {
                            console.log('[模板加载] 第一条记录时间:', templateResult.data.records[0].date_time);
                          }
                          // 保存到ref，确保Excel上传时可以立即访问（setState是异步的）
                          const templateRecords = ensureUiRecordIds(
                            templateResult.data.records,
                            `template:${selectedCableType}`,
                          );
                          templateDataRef.current = {
                            site: templateResult.data.site || '',
                            records: templateRecords,
                            page_count: templateResult.data.page_count || 1,
                            cableType: selectedCableType,
                            dataSource: 'template',
                          };
                          setParsedData(templateDataRef.current);
                        }
                        
                        // 直接上传Excel
                        setUploadingExcel(true);
                        const formData = new FormData();
                        formData.append('file', selectedExcelFile);
                        formData.append('cableType', selectedCableType);

                        try {
                          const excelResponse = await fetchWithTimeout('/api/upload-excel', {
                            method: 'POST',
                            body: formData,
                          }, 180000);

                          // 读取响应文本
                          const responseText = await excelResponse.text();
                          console.log('API响应大小:', (responseText.length / 1024).toFixed(2), 'KB');
                          
                          // 检查响应是否完整
                          const jsonStart = responseText.indexOf('{');
                          const jsonEnd = responseText.lastIndexOf('}');
                          console.log('JSON边界检查:', {
                            hasStart: jsonStart >= 0,
                            hasEnd: jsonEnd >= 0,
                            jsonLength: jsonEnd > jsonStart ? jsonEnd - jsonStart + 1 : 0
                          });
                          
                          // 如果响应不完整，尝试找到完整的JSON
                          let validJson = responseText;
                          if (jsonStart >= 0 && jsonEnd > jsonStart) {
                            validJson = responseText.substring(jsonStart, jsonEnd + 1);
                          }
                          
                          const excelResult = JSON.parse(validJson);

                          // 调试：验证API响应完整性
                          console.log('API响应验证:', {
                            success: excelResult.success,
                            totalCount: excelResult.totalCount,
                            filteredRows_length: excelResult.filteredRows?.length,
                            filteredRows_first: excelResult.filteredRows?.[0],
                            filteredRows_last: excelResult.filteredRows?.[excelResult.filteredRows?.length - 1]
                          });

                          if (excelResult.success) {
                            if (requestId !== importRequestIdRef.current) return;

                            // 保存Excel信息
                            setExcelInfo({
                              sheetName: excelResult.sheetName,
                              detectedColumns: excelResult.detectedColumns,
                              totalCount: excelResult.totalCount,
                            });

                            // 自动应用筛选的数据
                            if (excelResult.filteredRows && excelResult.filteredRows.length > 0) {
                              const filteredRows = excelResult.filteredRows;
                              
                              console.log(`[Excel导入] filteredRows 数量: ${filteredRows.length}`);
                              console.log(`[Excel导入] filteredRows 前5条:`, filteredRows.slice(0, 5).map((row: Record<string, unknown>) => row.cableNo));
                              console.log(`[Excel导入] filteredRows 最后5条:`, filteredRows.slice(-5).map((row: Record<string, unknown>) => row.cableNo));

                              // 验证filteredRows完整性 - 如果数据被截断则发出警告
                              if (filteredRows.length !== excelResult.totalCount) {
                                console.error(`⚠️ 数据不完整: API返回${excelResult.totalCount}条，但实际收到${filteredRows.length}条`);
                                alert(`数据不完整: 期望${excelResult.totalCount}条，实际${filteredRows.length}条。请尝试刷新页面后重新上传。`);
                              }

                              // 如果没有 Excel Date & Time 数据，使用用户设置的起始时间
                              const effectiveStartTime = startingDateTime;
                              const reportCableType = selectedCableType as ReportCableType;

                              console.log('[Excel导入] 数据源:', excelResult.dataSource);
                              console.log('[Excel导入] startingDateTime:', startingDateTime);
                              console.log('[Excel导入] detectedColumns:', excelResult.detectedColumns);
                              console.log('[Excel导入] filteredRows[0]:', JSON.stringify(filteredRows[0]));
                              console.log('[Excel导入] filteredRows[1]:', JSON.stringify(filteredRows[1]));

                              const hasExcelDateTime = filteredRows.some((row: Record<string, unknown>) =>
                                typeof row.dateTime === 'string' && row.dateTime.trim().length > 0
                              );
                              console.log('[Excel导入] Excel中是否有Date & Time数据:', hasExcelDateTime);

                              const importRows: CableImportRow[] = filteredRows.map(
                                (row: Record<string, unknown>, index: number) => {
                                  const rawLength = row.length;
                                  const length = rawLength !== undefined && rawLength !== null && rawLength !== ''
                                    ? Number.parseFloat(String(rawLength))
                                    : null;
                                  const rawRowNumber = Number(row.rowIndex);
                                  const rawExpansionIndex = Number(row.qtyIndex);

                                  return {
                                    cableNumber: String(row.cableNo || '').trim(),
                                    cableTypeText: String(row.cableType || ''),
                                    length,
                                    dateTime: typeof row.dateTime === 'string' ? row.dateTime : null,
                                    sourceLabel: typeof row.sourceLabel === 'string' ? row.sourceLabel : null,
                                    bandwidth: typeof row.bandwidth === 'string' ? row.bandwidth : null,
                                    source: {
                                      sheetName: String(row.sheetName || excelResult.sheetName || ''),
                                      rowNumber: Number.isFinite(rawRowNumber) ? rawRowNumber : index + 1,
                                      expansionIndex: Number.isFinite(rawExpansionIndex)
                                        ? Math.max(rawExpansionIndex - 1, 0)
                                        : 0,
                                      rule: reportCableType === 'Cat 5e (Vertical Cabling)'
                                        ? 'vertical-cabling'
                                        : reportCableType === 'LC'
                                          ? 'lc'
                                          : reportCableType === 'MPO'
                                            ? 'mpo'
                                            : 'cat5e-oob',
                                    },
                                  };
                                },
                              );

                              const mappedRecords = mapImportedRows(importRows, {
                                cableType: reportCableType,
                                startingDateTime: effectiveStartTime,
                                random: mathRandomSource,
                                idFactory: defaultRecordIdFactory,
                              });
                              const newRecords = toUiCableRecords(mappedRecords);

                              // 调试：打印前10条的时间，确保Cable Label和Date & Time一一对应
                              console.log(`[Excel导入] === Cable Label 与 Date & Time 对应关系（前10条）===`);
                              for (let i = 0; i < Math.min(10, newRecords.length); i++) {
                                console.log(`[Excel导入] [${i}] CableLabel="${newRecords[i].cable_label}" -> DateTime="${newRecords[i].date_time}"`);
                              }
                              console.log(`[Excel导入] === 对应关系验证结束 ===`);
                              
                              console.log(`Excel导入成功: 共 ${newRecords.length} 条记录`);
                              
                              // 直接更新状态
                              setParsedData({
                                site: siteNumber,
                                records: newRecords,
                                page_count: 1,
                                cableType: excelResult.cableType || selectedCableType,
                                dataSource: excelResult.dataSource,
                              });

                              setModificationStatus('ready');
                              
                              console.log('✓ Excel数据导入完成，已更新parsedData');
                            } else {
                              alert(`未找到匹配 ${selectedCableType} 的线缆数据`);
                            }
                          } else {
                            alert('Excel解析失败: ' + excelResult.error);
                          }
                        } catch (error) {
                          console.error('Excel upload error:', error);
                          const message = error instanceof DOMException && error.name === 'AbortError'
                            ? 'Excel上传或解析超时，请确认文件是否正确，然后重新导入'
                            : 'Excel上传失败';
                          alert(message);
                        } finally {
                          setUploadingExcel(false);
                        }
                      } else {
                        alert('模板加载失败: ' + templateResult.error);
                      }
                    } catch (error) {
                      console.error('Load template error:', error);
                      const message = error instanceof DOMException && error.name === 'AbortError'
                        ? '模板加载超时，请刷新页面后重试'
                        : '加载模板失败';
                      alert(message);
                    } finally {
                      setLoadingTemplate(false);
                    }
                  }}
                  disabled={!excelFile || loadingTemplate || uploadingExcel}
                  className="w-full"
                >
                  {loadingTemplate || uploadingExcel ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      处理中...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      加载并导入
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* 状态提示 */}
            {(loadingTemplate || uploadingExcel) && (
              <div className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>正在处理，请稍候...</span>
              </div>
            )}

            {/* 显示信息 */}
            <div className="mt-4 space-y-2">
              {siteNumber && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  ✓ 项目号: {siteNumber}
                </p>
              )}
              {cableType && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  ✓ 线缆类型: {cableType}
                </p>
              )}
              {excelFile && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  ✓ 已选择: {excelFile.name}
                </p>
              )}

              {excelInfo && (
                <div className="text-sm text-green-600 dark:text-green-400 space-y-1">
                  <p>✓ 工作表: {excelInfo.sheetName}</p>
                  <p>✓ 识别列: {excelInfo.detectedColumns?.cableNo}</p>
                  <p>✓ 匹配数据: {excelInfo.totalCount} 条</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Data Table */}
        {parsedData && (
          <>
            {/* 起始时间设置 */}
            <Card className="mb-4">
              <CardContent className="py-3">
                <div className="flex items-center justify-center gap-6">
                  <div className="flex items-center gap-3">
                    <Label className="text-sm font-medium whitespace-nowrap">起始时间设置：</Label>
                    <DateTimePicker
                      value={startingDateTime}
                      onChange={(value) => {
                        console.log(`[起始时间修改] 新值: ${value}`);
                        setStartingDateTime(value);
                        // 自动更新所有记录的时间
                        const newTimes = generateDecreasingTimes(value, parsedData.records.length);
                        console.log(`[起始时间修改] newTimes[0]: ${newTimes[0]}`);
                        console.log(`[起始时间修改] newTimes[1]: ${newTimes[1]}`);
                        setParsedData(prev => {
                          if (!prev) return prev;
                          const updated = {
                            ...prev,
                            records: prev.records.map((record, index) => ({
                              ...record,
                              date_time: newTimes[index] || record.date_time,
                            })),
                          };
                          console.log(`[起始时间修改] 更新后 records[0].date_time: ${updated.records[0]?.date_time}`);
                          return updated;
                        });
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <Clock className="w-4 h-4" />
                    <span>工作时间：上午 {TIME_RANGES.morning.start}:00-{TIME_RANGES.morning.end}:00，下午 {TIME_RANGES.afternoon.start}:00-{TIME_RANGES.afternoon.end}:00</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="mb-6">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    测试数据预览
                    <Badge variant="secondary">
                      {parsedData.records.length} 条记录
                    </Badge>
                  </CardTitle>
                  <div className="flex gap-2">
                    {editingRecords.size > 0 ? (
                      <>
                        <Button
                          onClick={handleBatchSave}
                          variant="default"
                          size="sm"
                        >
                          <Save className="w-4 h-4 mr-2" />
                          保存全部修改
                        </Button>
                        <Button
                          onClick={handleBatchCancel}
                          variant="outline"
                          size="sm"
                        >
                          <X className="w-4 h-4 mr-2" />
                          取消全部
                        </Button>
                      </>
                    ) : (
                      <Button onClick={handleBatchEdit} variant="outline" size="sm">
                        <Edit2 className="w-4 h-4 mr-2" />
                        批量编辑
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600 dark:text-slate-400">项目号确认:</span>
                  <Input
                    value={parsedData.site || siteNumber}
                    onChange={(e) => {
                      setSiteNumber(e.target.value);
                      setParsedData(prev => {
                        if (!prev) return prev;
                        return { ...prev, site: e.target.value };
                      });
                    }}
                    className="w-64 h-8 text-sm"
                    placeholder="输入项目号"
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-slate-100 dark:bg-slate-800">
                        <TableRow>
                          <TableHead className="font-semibold">序号</TableHead>
                          <TableHead className="font-semibold">Cable Label</TableHead>
                          <TableHead className="font-semibold">Limit</TableHead>
                          <TableHead className="font-semibold">Result</TableHead>
                          <TableHead className="font-semibold">Length (m)</TableHead>
                          <TableHead className="font-semibold">NEXT Margin (dB)</TableHead>
                          <TableHead className="font-semibold">Date & Time</TableHead>
                          <TableHead className="font-semibold">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsedData.records.map((record, index) => {
                          const isEditing = editingRecords.has(index);
                          const tempValue = tempValues[index];
                          const displayDateTime = record.date_time;
                          const timeStr = displayDateTime.split(' ').slice(1).join(' ');
                          const isTimeValid = isValidWorkingTime(timeStr);

                          return (
                            <TableRow key={record.id} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                              <TableCell className="font-medium">
                                {index + 1}
                              </TableCell>
                              <TableCell>
                                {isEditing ? (
                                  <Input
                                    value={tempValue?.cable_label || ''}
                                    onChange={(e) => handleTempValueChange(index, 'cable_label', e.target.value)}
                                    className="w-32"
                                  />
                                ) : (
                                  <Badge variant="outline">{record.cable_label}</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-sm">
                                {record.limit}
                              </TableCell>
                              <TableCell>
                                <Badge variant={record.result === 'PASS' ? 'default' : 'destructive'}>
                                  {record.result}
                                </Badge>
                              </TableCell>
                              <TableCell>{record.length}</TableCell>
                              <TableCell>{record.next_margin}</TableCell>
                              <TableCell>
                                <div>
                                  <span className="text-sm">{displayDateTime}</span>
                                  {index === 0 && (
                                    <p className="text-xs text-blue-600">起始时间</p>
                                  )}
                                  {index !== 0 && (
                                    <p className="text-xs text-slate-500">自动递增</p>
                                  )}
                                  {!isTimeValid && (
                                    <p className="text-xs text-amber-600">⚠️ 不在工作时间</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {!isEditing && (
                                  <Button
                                    onClick={() => handleDeleteRecord(index)}
                                    variant="ghost"
                                    size="sm"
                                  >
                                    <Trash2 className="w-4 h-4 text-red-500" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Generate PDF Button */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-center">
                  <Button
                    onClick={handleModifyPDF}
                    disabled={loading || modificationStatus === 'idle'}
                    size="lg"
                    className="min-w-48"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        修改中...
                      </>
                    ) : (
                      <>
                        <Download className="w-5 h-5 mr-2" />
                        生成测试报告
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Empty State */}
        {!parsedData && (
          <Card>
            <CardContent className="py-16">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
                  <FileText className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-medium text-slate-800 dark:text-white mb-2">
                  选择线缆类型开始编辑
                </h3>
                <p className="text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                  选择线缆类型并加载模板，我们将解析模板数据。
                  然后可以导入Excel布线表进行批量映射，修改后的PDF将保持原始格式。
                </p>
              </div>
            </CardContent>
          </Card>
        )}


      </div>
    </div>
  );
}
