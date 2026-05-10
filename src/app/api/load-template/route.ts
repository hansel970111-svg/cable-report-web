import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { runPythonScript } from '@/lib/platform';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cableType } = body;
    
    if (!cableType) {
      return NextResponse.json({ error: 'Cable type is required' }, { status: 400 });
    }
    
    // Map cable type to template file
    const templateMap: Record<string, string> = {
      'Cat 5e': 'assets/M138-DE46-OOB-Cat5e.pdf',
      'Cat 5e (Vertical Cabling)': 'assets/M138-DE46-OOB-Cat5e.pdf',
      'LC': 'assets/M138-DE46-D-P-cross-LC.pdf',
      'MPO': 'assets/M138-DE46-P-A-MPO.pdf',
    };
    
    const templatePath = templateMap[cableType];
    if (!templatePath) {
      return NextResponse.json({ error: 'Unsupported cable type' }, { status: 400 });
    }
    
    // Get project root - use environment variable or process.cwd()
    const projectRoot = process.env.COZE_WORKSPACE_PATH || process.cwd();
    
    // Parse PDF using Python script
    const scriptPath = path.join(projectRoot, 'scripts', 'pdf_processor.py');
    const absoluteTemplatePath = path.join(projectRoot, templatePath);
    
    const { stdout, stderr } = await runPythonScript(scriptPath, ['parse', absoluteTemplatePath]);
    
    if (stderr && !stdout) {
      console.error('Python error:', stderr);
      return NextResponse.json({ error: 'Failed to parse template PDF' }, { status: 500 });
    }
    
    const result = JSON.parse(stdout);
    
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    
    return NextResponse.json({
      success: true,
      data: result,
      templatePath,
    });
    
  } catch (error) {
    console.error('Load template error:', error);
    return NextResponse.json(
      { error: 'Failed to load template' },
      { status: 500 }
    );
  }
}
