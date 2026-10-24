import { assetUrl } from './assets';
import { passageError, MAX_PASSAGE_LENGTH } from '@/lib/dictation';
import { pdfPageText } from '@/lib/passage-text';

function readWord(data: ArrayBuffer, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./passage.worker.ts', import.meta.url), {
      type: 'module',
    });
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.text);
    };
    worker.onerror = () => {
      cleanup();
      reject(
        new Error(
          'This Word file could not be read. Try a smaller .docx file or paste the text.',
        ),
      );
    };
    if (signal.aborted) {
      abort();
      return;
    }
    worker.postMessage(data, [data]);
  });
}

async function readPDF(data: ArrayBuffer, signal: AbortSignal) {
  const pdf = await import('pdfjs-dist');
  signal.throwIfAborted();
  pdf.GlobalWorkerOptions.workerSrc = assetUrl('pdfjs/pdf.worker.min.mjs');
  const task = pdf.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
  });
  const abort = () => {
    void task.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const document = await task.promise;
    if (document.numPages > 30)
      throw new Error(
        'Use a PDF of 30 pages or fewer. Export just the dictation passage.',
      );
    const pages: string[] = [];
    let length = 0;
    for (let n = 1; n <= document.numPages; n++) {
      signal.throwIfAborted();
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      const text = pdfPageText(content.items.filter((item) => 'str' in item));
      pages.push(text);
      length += text.length;
      page.cleanup();
      if (length > MAX_PASSAGE_LENGTH)
        throw new Error(
          'This passage is over 20,000 characters. Export a shorter PDF.',
        );
    }
    return pages.join('\n\n');
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error(
        'This PDF is password-protected. Upload an unlocked copy or paste the passage.',
      );
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    await task.destroy();
  }
}

/** Parse locally and return text only; never render document HTML or fetch file links. */
export async function readPassage(file: File, externalSignal: AbortSignal) {
  if (file.size > 10 * 1024 * 1024)
    throw new Error('Choose a file smaller than 10 MB.');
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (!['txt', 'docx', 'pdf'].includes(extension || ''))
    throw new Error(
      'Upload a .txt, .docx, or text-based .pdf file. Older .doc files must be saved as .docx first.',
    );
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal.reason);
  externalSignal.addEventListener('abort', abort, { once: true });
  if (externalSignal.aborted) abort();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error(
          'Reading the file took too long. Try a smaller file or paste the passage.',
        ),
      ),
    30000,
  );
  try {
    const data = await file.arrayBuffer();
    controller.signal.throwIfAborted();
    let text: string;
    if (extension === 'docx') text = await readWord(data, controller.signal);
    else if (extension === 'pdf') text = await readPDF(data, controller.signal);
    else {
      const bytes = new Uint8Array(data);
      const encoding =
        bytes[0] === 255 && bytes[1] === 254
          ? 'utf-16le'
          : bytes[0] === 254 && bytes[1] === 255
            ? 'utf-16be'
            : 'utf-8';
      try {
        text = new TextDecoder(encoding, { fatal: true }).decode(data);
      } catch {
        throw new Error(
          'Save this text file with UTF-8 encoding, or paste the passage.',
        );
      }
    }
    controller.signal.throwIfAborted();
    text = text
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '')
      .trim();
    const problem = passageError(text);
    if (problem) throw new Error(problem);
    return text;
  } finally {
    clearTimeout(timeout);
    externalSignal.removeEventListener('abort', abort);
  }
}
