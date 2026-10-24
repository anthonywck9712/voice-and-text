export const MAX_PASSAGE_LENGTH = 20000;
export const MAX_PHRASES = 400;
export type ReadingOptions = {
  dictationPause?: number;
  readPunctuation?: boolean;
};
export type PhrasePosition = {
  phrase: number;
  count: number;
  remaining: number;
};
export const EMPTY_POSITION: PhrasePosition = {
  phrase: 0,
  count: 0,
  remaining: 0,
};

/** Each nonempty line is a teacher-approved phrase. Preserve original offsets. */
export function dictationPhrases(text: string) {
  return [...text.matchAll(/[^\r\n]+/gu)]
    .filter((match) => match[0].trim())
    .map((match) => ({
      text: match[0].trim(),
      offset: match.index! + match[0].length - match[0].trimStart().length,
    }));
}

/** Suggest short groups without changing words, punctuation, or their order. */
export function phraseBreaks(text: string, targetWords = 6) {
  if (![4, 6, 8, 12].includes(targetWords))
    throw new Error('Choose a supported phrase length.');
  const phrases: string[] = [];
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  for (const paragraph of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    for (const { segment } of segmenter.segment(paragraph)) {
      const words = segment.trim().split(/\s+/u).filter(Boolean);
      while (words.length) {
        if (words.length <= targetWords + 2) {
          phrases.push(words.join(' '));
          break;
        }
        // Prefer an actual clause boundary near the selected length.
        const min = Math.max(2, targetWords - 2);
        const max = Math.min(words.length - 2, targetWords + 2);
        let cut = targetWords;
        let best = Infinity;
        for (let i = min; i <= max; i++) {
          if (
            /[,;:!?—][”’"')\]]?$/u.test(words[i - 1]) &&
            Math.abs(i - targetWords) < best
          ) {
            cut = i;
            best = Math.abs(i - targetWords);
          }
        }
        phrases.push(words.splice(0, cut).join(' '));
      }
    }
  }
  return phrases.join('\n');
}

export function passageError(text: string) {
  if (!text.trim())
    return 'This file contains no readable text. For a scanned PDF, paste the passage or upload a Word/text file.';
  if (text.length > MAX_PASSAGE_LENGTH)
    return 'This passage is over 20,000 characters. Upload a shorter passage; nothing has been replaced.';
  return '';
}
