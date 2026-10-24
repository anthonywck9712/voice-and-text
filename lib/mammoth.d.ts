declare module 'mammoth/mammoth.browser.js' {
  const mammoth: {
    extractRawText(input: {
      arrayBuffer: ArrayBuffer;
    }): Promise<{ value: string; messages: { message: string }[] }>;
  };
  export default mammoth;
}
