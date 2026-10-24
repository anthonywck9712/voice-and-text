/**
 * Make a spoken copy of a teacher's passage, without changing its source offsets.
 *
 * Punctuation inside contractions/possessives, numbers, times, common titles and
 * abbreviations, initials, URLs and email addresses keeps its normal pronunciation
 * instead of being named. A full stop that also ends an abbreviation is therefore
 * not named separately. A terminal apostrophe after s, outside an open quotation,
 * is treated as a possessive. Unusual abbreviations may need teacher editing.
 *
 * Always pass the entire original passage, even when requesting one phrase. Quote
 * direction and protected tokens are determined before selecting the source range.
 */
export const PUNCTUATION_PAUSE_SECONDS = 0.22;

export type DictationSpeechSegment = {
  text: string;
  offset: number;
  end: number;
  punctuation: boolean;
};

export function dictationSpeechSegments(
  source: string,
  offset = 0,
  end = source.length,
): DictationSpeechSegment[] {
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(end) ||
    offset < 0 ||
    end < offset ||
    end > source.length
  ) {
    throw new RangeError('Choose a valid passage range.');
  }

  const protectedChars = new Uint8Array(source.length);
  const protect = (pattern: RegExp, trimUrl = false) => {
    for (const match of source.matchAll(pattern)) {
      const start = match.index!;
      let stop = start + match[0].length;
      if (trimUrl) {
        // Sentence punctuation following a URL belongs to the passage. Preserve
        // balanced URL parentheses, such as /wiki/Example_(disambiguation).
        const balances: Record<string, number> = { ')': 0, ']': 0, '}': 0 };
        for (let i = start; i < stop; i++) {
          if (source[i] === '(') balances[')']++;
          else if (source[i] === '[') balances[']']++;
          else if (source[i] === '{') balances['}']++;
          else if (source[i] in balances) balances[source[i]]--;
        }
        while (stop > start) {
          const last = source[stop - 1];
          if (/[.,;:!?]/u.test(last)) {
            stop--;
          } else if (last === ')' || last === ']' || last === '}') {
            if (balances[last] >= 0) break;
            balances[last]++;
            stop--;
          } else break;
        }
      }
      protectedChars.fill(1, start, stop);
    }
  };

  protect(/\b(?:https?:\/\/|www\.)[^\s<>"“”‘’]+/giu, true);
  // Bounding the local part also keeps unsuccessful email scans bounded on a
  // long unbroken word. Standard email local parts are at most 64 characters.
  protect(
    /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/gu,
  );
  protect(/\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:\/[^\s<>"“”‘’]*)?/gu, true);
  protect(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/gu);
  protect(/\b\d{1,2}:\d{2}(?::\d{2})?\b/gu);
  protect(
    /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|St|Rev|Hon|Capt|Lt|Sgt|Gen|Col|Fig|No|Nos|vs|etc|approx|dept|est|Inc|Ltd|Co|Ave|Rd|Mt)\./giu,
  );
  protect(/\b(?:[A-Za-z]\.){2,}/gu);
  protect(/\b[A-Z]\.(?=\s+[A-Z][\p{L}’'-])/gu);

  const letterOrNumber = (character = '') => /[\p{L}\p{N}]/u.test(character);
  const result: DictationSpeechSegment[] = [];
  let doubleQuoteOpen = false;
  let singleQuoteOpen = false;
  const emit = (
    index: number,
    value: string,
    named = false,
    stop = index + 1,
  ) => {
    if (index < offset || index >= end) return;
    const previous = result.at(-1);
    if (!named && previous && !previous.punctuation) {
      previous.text += value;
      previous.end = Math.min(stop, end);
    } else {
      result.push({
        text: value,
        offset: index,
        end: Math.min(stop, end),
        punctuation: named,
      });
    }
  };
  const simple: Record<string, string> = {
    ',': 'comma',
    '?': 'question mark',
    '!': 'exclamation mark',
    ':': 'colon',
    ';': 'semicolon',
    '(': 'open bracket',
    ')': 'close bracket',
    '[': 'open square bracket',
    ']': 'close square bracket',
    '{': 'open curly bracket',
    '}': 'close curly bracket',
    '–': 'dash',
    '—': 'dash',
    '…': 'ellipsis',
    '/': 'slash',
    '\\': 'backslash',
  };

  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    const before = source[i - 1] ?? '';
    const after = source[i + 1] ?? '';
    if (protectedChars[i]) {
      emit(i, character);
      continue;
    }
    if (character === '.') {
      if (
        /\d/u.test(after) &&
        (/\d/u.test(before) || !letterOrNumber(before))
      ) {
        emit(i, character);
      } else if (source.startsWith('...', i)) {
        const start = i;
        while (source[i + 1] === '.') i++;
        emit(start, 'ellipsis', true, i + 1);
      } else emit(i, 'full stop', true);
      continue;
    }
    if (character === '"' || character === '“' || character === '”') {
      const opening: boolean =
        character === '“' || (character === '"' && !doubleQuoteOpen);
      doubleQuoteOpen = opening;
      emit(i, `${opening ? 'open' : 'close'} quotation marks`, true);
      continue;
    }
    if (character === "'" || character === '‘' || character === '’') {
      const wordApostrophe = letterOrNumber(before) && letterOrNumber(after);
      const possessive =
        /s/iu.test(before) && !letterOrNumber(after) && !singleQuoteOpen;
      const elision =
        character !== '‘' &&
        !letterOrNumber(before) &&
        /^(?:tis|twas|twere|cause|em|til|till|tween|round|bout|nother|\d{2}s)\b/iu.test(
          source.slice(i + 1, i + 10),
        );
      if (wordApostrophe || possessive || elision) {
        emit(i, character);
      } else {
        const opening: boolean =
          character === '‘' || (character === "'" && !singleQuoteOpen);
        singleQuoteOpen = opening;
        emit(i, `${opening ? 'open' : 'close'} single quotation marks`, true);
      }
      continue;
    }
    if (character === '-') {
      if (source[i + 1] === '-') {
        const start = i;
        while (source[i + 1] === '-') i++;
        emit(start, 'dash', true, i + 1);
      } else emit(i, 'hyphen', true);
      continue;
    }
    const name = simple[character];
    emit(i, name ?? character, !!name);
  }
  return result.filter((segment) => {
    segment.text = segment.text.replace(/\s+/gu, ' ').trim();
    return !!segment.text;
  });
}

/** Plain spoken copy retained for previews and checking split continuations. */
export function dictationSpeech(
  source: string,
  offset = 0,
  end = source.length,
): string {
  return dictationSpeechSegments(source, offset, end)
    .map((segment) => segment.text)
    .join(' ');
}

/** Keep continuation-only ellipsis/dash slices with a speaking source range. */
export function coalesceSpokenChunks<
  T extends {
    text: string;
    offset: number;
    phrase: number;
    pauseAfter: number;
  },
>(source: string, chunks: T[]): T[] {
  const merged = chunks.map((chunk) => ({ ...chunk }));
  for (let i = 0; i < merged.length;) {
    const chunk = merged[i];
    if (
      dictationSpeech(source, chunk.offset, chunk.offset + chunk.text.length)
    ) {
      i++;
      continue;
    }
    const previous = merged[i - 1];
    const next = merged[i + 1];
    if (previous?.phrase === chunk.phrase) {
      previous.text = source.slice(
        previous.offset,
        chunk.offset + chunk.text.length,
      );
      previous.pauseAfter = chunk.pauseAfter;
      merged.splice(i, 1);
    } else if (next?.phrase === chunk.phrase) {
      next.text = source.slice(chunk.offset, next.offset + next.text.length);
      next.offset = chunk.offset;
      merged.splice(i, 1);
    } else {
      throw new Error(
        'This phrase has no speakable text. Edit the phrase and try again.',
      );
    }
  }
  return merged;
}
