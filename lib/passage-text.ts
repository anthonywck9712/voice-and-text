type PDFTextItem = {
  str: string;
  hasEOL?: boolean;
  transform: number[];
  width: number;
  height: number;
};
/** PDF text runs can end inside a word. Use layout gaps, not one space per run. */
export function pdfPageText(items: PDFTextItem[]) {
  let result = '';
  let previous: PDFTextItem | undefined;
  for (const item of items) {
    if (previous && !/\s$/u.test(result) && !/^\s/u.test(item.str)) {
      const height = Math.max(1, Math.abs(item.height || item.transform[3]));
      const lineChanged =
        Math.abs(item.transform[5] - previous.transform[5]) >
        Math.max(2, height * 0.5);
      const gap = item.transform[4] - (previous.transform[4] + previous.width);
      if (lineChanged) result += '\n';
      else if (gap > Math.max(0.5, height * 0.12)) result += ' ';
    }
    result += item.str;
    if (item.hasEOL && !result.endsWith('\n')) result += '\n';
    previous = item;
  }
  return result;
}
