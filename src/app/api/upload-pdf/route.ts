import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { runPythonScript } from '@/lib/platform';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    
    // 使用跨平台兼容的临时目录
    const tempDir = path.join(os.tmpdir(), 'pdf-uploads');
    await fs.mkdir(tempDir, { recursive: true });
    
    const timestamp = Date.now();
    const inputPath = path.join(tempDir, `input-${timestamp}.pdf`);
    
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await fs.writeFile(inputPath, buffer);
    
    // Parse PDF using Python script
    const projectRoot = process.env.COZE_WORKSPACE_PATH || process.cwd();
    const scriptPath = path.join(projectRoot, 'scripts', 'pdf_processor.py');
    
    const { stdout, stderr } = await runPythonScript(
      scriptPath,
      ['parse', inputPath],
      { 
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    
    if (stderr && !stdout) {
      console.error('Python error:', stderr);
      return NextResponse.json({ error: 'Failed to parse PDF' }, { status: 500 });
    }
    
    const result = JSON.parse(stdout);
    
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    
    // Clean up input file
    await fs.unlink(inputPath).catch(() => {});
    
    return NextResponse.json({
      success: true,
      data: result,
      tempPath: inputPath // Return path for later use
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Failed to process PDF upload' },
      { status: 500 }
    );
  }
}
