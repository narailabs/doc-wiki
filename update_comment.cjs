const fs = require('fs');
const filepath = 'agents/lib/atlas_inventory.ts';
let content = fs.readFileSync(filepath, 'utf-8');

content = content.replace(
  'function _countLinesTo(str: string, idx: number): number {',
  '/**\n * Performance optimization: Calculates 1-based line number for a specific\n * string index using a backward lastIndexOf loop. Avoids O(N) memory allocations\n * caused by String.slice().split("\\\\n").length.\n */\nfunction _countLinesTo(str: string, idx: number): number {'
);

fs.writeFileSync(filepath, content);
