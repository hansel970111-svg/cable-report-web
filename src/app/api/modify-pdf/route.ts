import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveAppPath, runPythonScript } from '@/lib/platform';

interface CableRecord {
  cable_label: string;
  cable_number: string;
  limit: string;
  result: string;
  length: string;
  next_margin: string;
  date_time: string;
  page: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cableType, site, records } = body;
    
    // 调试日志
    console.log(`[API] 收到请求: cableType=${cableType}, site=${site}`);
    
    if (!cableType) {
      return NextResponse.json({ error: 'Cable type is required' }, { status: 400 });
    }
    
    if (!records || !Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'Records are required' }, { status: 400 });
    }
    
    // 验证每条记录的必需字段
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      
      // Cable Label 字段仅对 Cat5e 类型是必需的
      if (cableType === 'Cat 5e' || cableType === 'Cat 5e (Vertical Cabling)') {
        if (!record.cable_label) {
          return NextResponse.json({ 
            error: `记录 ${i + 1} 缺少 cable_label 字段` 
          }, { status: 400 });
        }
        if (record.length === undefined || record.length === null) {
          return NextResponse.json({ 
            error: `记录 ${i + 1} 缺少 length 字段` 
          }, { status: 400 });
        }
        if (record.next_margin === undefined || record.next_margin === null) {
          return NextResponse.json({ 
            error: `记录 ${i + 1} 缺少 next_margin 字段` 
          }, { status: 400 });
        }
      }
      
      if (!record.date_time) {
        return NextResponse.json({ 
          error: `记录 ${i + 1} 缺少 date_time 字段` 
        }, { status: 400 });
      }
    }
    
    // Map cable type to template file
    const templateMap: Record<string, string> = {
      'Cat 5e': 'assets/M138-DE46-OOB-Cat5e.pdf',
      'Cat 5e (Vertical Cabling)': 'assets/M138-DE46-OOB-Cat5e.pdf',
      'MPO': 'assets/M138-DE46-P-A-MPO.pdf',
      'LC': 'assets/M138-DE46-D-P-cross-LC.pdf',
    };
    
    const templatePath = templateMap[cableType];
    if (!templatePath) {
      return NextResponse.json({ error: 'Unsupported cable type' }, { status: 400 });
    }
    
    // 使用跨平台兼容的临时目录
    const tempDir = path.join(os.tmpdir(), 'pdf-modifications');
    await fs.mkdir(tempDir, { recursive: true });
    
    const timestamp = Date.now();
    const inputPath = resolveAppPath(templatePath);
    const outputPath = path.join(tempDir, `output-${timestamp}.pdf`);
    
    // Prepare modifications with complete record data
    // Site 字段转换为大写，因为 PDF 模板只支持大写字母
    // Cable Label：Cat5e 类型使用 cable_label，MPO 类型使用 cable_number
    const modifications = {
      site: site ? site.toUpperCase() : '',
      records: records.map((record: CableRecord) => ({
        cable_label: record.cable_label || record.cable_number || '',
        limit: record.limit || 'TIA - Cat 5e Channel', // 默认值
        result: record.result || 'PASS', // 默认值为 PASS
        date_time: record.date_time,
        length: record.length,
        next_margin: record.next_margin,
      })),
    };
    
    // 调试：记录发送的记录数量
    console.log(`[API] 准备发送 ${modifications.records.length} 条记录到Python脚本`);
    console.log(`[API] 第一条: ${JSON.stringify(modifications.records[0])}`);
    console.log(`[API] 最后一条: ${JSON.stringify(modifications.records[modifications.records.length - 1])}`);
    
    // Execute PDF editor
    const scriptPath = resolveAppPath('scripts', 'pdf_editor.py');
    const modificationsJson = JSON.stringify(modifications);
    console.log(`[API] JSON字符串长度: ${modificationsJson.length} 字符`);
    
    // Write modifications to temp file (跨平台兼容方式)
    const jsonPath = path.join(tempDir, `modifications-${timestamp}.json`);
    await fs.writeFile(jsonPath, modificationsJson, 'utf-8');
    
    // 将JSON文件路径作为参数传递，让Python脚本读取
    // 这样避免 shell 引号、cat 命令、Windows 反斜杠路径等跨平台问题
    const { stdout, stderr } = await runPythonScript(
      scriptPath,
      [inputPath, outputPath, jsonPath],
      { 
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      }
    );
    
    // Clean up JSON file
    await fs.unlink(jsonPath).catch(() => {});
    
    // 检查是否有错误（stderr 不为空且没有有效的 JSON 输出）
    const hasValidOutput = stdout && stdout.trim().startsWith('{');
    const hasError = stderr && stderr.includes('Error') && !hasValidOutput;
    
    if (hasError) {
      console.error('Python error:', stderr);
      return NextResponse.json({ error: 'Failed to modify PDF' }, { status: 500 });
    }
    
    const result = hasValidOutput ? JSON.parse(stdout) : {};
    
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    
    // Generate filename: 项目号_线缆类型_生成时间.pdf
    const sanitizedSite = site ? site.replace(/[^a-zA-Z0-9_-]/g, '_') : 'Unknown';
    const sanitizedCableType = cableType.replace(/[^a-zA-Z0-9]/g, '_');
    const generatedAt = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const timestampSuffix = [
      generatedAt.getFullYear(),
      pad(generatedAt.getMonth() + 1),
      pad(generatedAt.getDate()),
      '_',
      pad(generatedAt.getHours()),
      pad(generatedAt.getMinutes()),
      pad(generatedAt.getSeconds()),
    ].join('');
    const filename = `${sanitizedSite}_${sanitizedCableType}_${timestampSuffix}.pdf`;

    // Read the modified PDF
    const pdfBuffer = await fs.readFile(outputPath);

    // The in-app browser may not persist attachment downloads to Finder's Downloads
    // folder, so keep a local copy there as a reliable fallback for manual testing.
    const downloadsPath = path.join(os.homedir(), 'Downloads', filename);
    await fs.writeFile(downloadsPath, pdfBuffer).catch((writeError) => {
      console.warn(`[API] Failed to save copy to Downloads: ${downloadsPath}`, writeError);
    });
    console.log(`[API] PDF saved to Downloads: ${downloadsPath}`);

    // Clean up temp files
    await fs.unlink(outputPath).catch(() => {});

    // Return PDF as response
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Saved-Path': downloadsPath,
      }
    });
    
  } catch (error) {
    console.error('Modify error:', error);
    return NextResponse.json(
      { error: 'Failed to modify PDF' },
      { status: 500 }
    );
  }
}
