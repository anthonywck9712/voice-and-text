import mammoth from 'mammoth/mammoth.browser.js';
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const { value } = await mammoth.extractRawText({ arrayBuffer: event.data });
    self.postMessage({ text: value });
  } catch {
    self.postMessage({
      error:
        'This Word file could not be read. Save it as a new .docx file or paste the passage.',
    });
  }
};
