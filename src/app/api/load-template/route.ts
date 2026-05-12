import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { getAppPathCandidates, resolveAppPath, runPythonScript } from '@/lib/platform';

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
    
    const absoluteTemplatePath = resolveAppPath(templatePath);
    if (!fs.existsSync(absoluteTemplatePath)) {
      console.error('[load-template] Template file not found', {
        templatePath,
        candidates: getAppPathCandidates(templatePath),
      });
      return NextResponse.json({ error: 'Template file not found' }, { status: 500 });
    }

    const fallbackResult = {
      site: '',
      records: [],
      page_count: 1,
      cable_type: cableType,
    };

    let result = fallbackResult;
    try {
      const scriptPath = resolveAppPath('scripts', 'pdf_processor.py');
      const { stdout, stderr } = await runPythonScript(scriptPath, ['parse', absoluteTemplatePath]);

      if (stderr && !stdout) {
        console.warn('[load-template] Template parser stderr:', stderr);
      } else if (stdout) {
        const parsed = JSON.parse(stdout);
        if (parsed.error) {
          console.warn('[load-template] Template parser returned error:', parsed.error);
        } else {
          result = parsed;
        }
      }
    } catch (parseError) {
      console.warn('[load-template] Template parser failed; continuing with fallback data.', parseError);
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
