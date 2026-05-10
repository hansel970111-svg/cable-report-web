import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { runPythonScript } from '@/lib/platform';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { data } = body;
    
    if (!data || !data.records) {
      return NextResponse.json({ error: 'No data provided' }, { status: 400 });
    }
    
    // 使用跨平台兼容的临时目录
    const tempDir = path.join(os.tmpdir(), 'pdf-uploads');
    await fs.mkdir(tempDir, { recursive: true });
    
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `output-${timestamp}.pdf`);
    
    // Generate PDF using Python script
    const projectRoot = process.env.COZE_WORKSPACE_PATH || process.cwd();
    const scriptPath = path.join(projectRoot, 'scripts', 'pdf_processor.py');
    const dataJson = JSON.stringify(data);
    
    // Use a temp file for the JSON data (跨平台兼容方式)
    const jsonPath = path.join(tempDir, `data-${timestamp}.json`);
    await fs.writeFile(jsonPath, dataJson, 'utf-8');
    
    const { stdout, stderr } = await runPythonScript(
      scriptPath,
      ['generate', outputPath, jsonPath],
      { 
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    
    // Clean up JSON file
    await fs.unlink(jsonPath).catch(() => {});
    
    if (stderr && !stdout) {
      console.error('Python error:', stderr);
      return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
    }
    
    const result = JSON.parse(stdout);
    
    if (!result.success) {
      return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
    }
    
    // Read the generated PDF
    const pdfBuffer = await fs.readFile(outputPath);
    
    // Clean up output file
    await fs.unlink(outputPath).catch(() => {});
    
    // Return PDF as response
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="cable_test_report_modified.pdf"'
      }
    });
    
  } catch (error) {
    console.error('Generate error:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
