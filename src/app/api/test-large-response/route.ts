import { NextResponse } from 'next/server';

// 测试大JSON响应
export async function GET() {
  // 生成1761条测试数据
  const rows = [];
  for (let i = 1; i <= 1761; i++) {
    rows.push({
      cableNo: `MPO ${String(i).padStart(4, '0')}`,
      length: 10,
      cableType: `MPO-200G-A${String(i).padStart(4, '0')}`,
      bandwidth: '200G',
      rowIndex: i + 1
    });
  }
  
  return NextResponse.json({
    success: true,
    totalCount: rows.length,
    filteredRows: rows,
    dataSource: 'MPO'
  });
}
