'use client';
import { useEffect, useRef, useState } from 'react';
import { FileUp, LoaderCircle, Scissors } from 'lucide-react';
import {
  dictationPhrases,
  MAX_PHRASES,
  passageError,
  phraseBreaks,
} from '@/lib/dictation';
import { readPassage } from '@/lib/read-passage';

export default function DictationEditor({
  value,
  onChange,
  active,
  onImporting,
}: {
  value: string;
  onChange: (value: string) => void;
  active: boolean;
  onImporting: (busy: boolean) => void;
}) {
  const [length, setLength] = useState(6);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ name: string; text: string } | null>(
    null,
  );
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      onImporting(false);
    },
    [onImporting],
  );
  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setLoading(false);
    setPending(null);
    onImporting(false);
    setError('');
  };
  const upload = async (file: File) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setPending(null);
    setError('');
    onImporting(true);
    try {
      const text = await readPassage(file, controller.signal);
      if (!controller.signal.aborted) setPending({ name: file.name, text });
    } catch (problem) {
      if (!controller.signal.aborted) {
        setError(
          problem instanceof Error
            ? problem.message
            : 'This file could not be read. Try another file or paste the text.',
        );
        onImporting(false);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  const split = (text: string) => {
    const result = phraseBreaks(text, length);
    if (dictationPhrases(result).length > MAX_PHRASES) {
      setError(
        'This creates more than 400 phrases. Choose longer phrases or use a shorter passage.',
      );
      return false;
    }
    onChange(result);
    setError('');
    return true;
  };
  return (
    <>
      <div className="dictation-upload">
        <div>
          <strong>A passage for the class</strong>
          <p>Word (.docx), text-based PDF, or TXT · up to 10 MB</p>
        </div>
        <input
          ref={input}
          type="file"
          className="sr-only"
          aria-label="Upload dictation passage"
          accept=".txt,.docx,.pdf"
          disabled={active || loading || !!pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
        <button
          type="button"
          className="secondary-button"
          disabled={active || loading || !!pending}
          onClick={() => input.current?.click()}
        >
          <FileUp size={17} />
          Upload passage
        </button>
      </div>
      {loading && (
        <div className="import-state" role="status">
          <LoaderCircle size={18} className="spin" />
          Reading your file on this device…
          <button className="text-button" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      <div className="phrase-tools">
        <label htmlFor="phrase-length">Suggested phrase length</label>
        <select
          id="phrase-length"
          value={length}
          disabled={active || loading}
          onChange={(e) => setLength(Number(e.target.value))}
        >
          <option value={4}>Short · about 4 words</option>
          <option value={6}>Medium · about 6 words</option>
          <option value={8}>Long · about 8 words</option>
          <option value={12}>Extended · about 12 words</option>
        </select>
        {!pending && (
          <button
            className="text-button"
            disabled={active || loading || !value.trim()}
            onClick={() => split(value.replace(/\s*\n\s*/g, ' '))}
          >
            <Scissors size={15} />
            Suggest breaks
          </button>
        )}
      </div>
      {pending ? (
        <div className="import-review">
          <label htmlFor="imported-passage">Review imported passage</label>
          <p>
            {pending.name} · Remove any headings or instructions you do not want
            read aloud.
          </p>
          <textarea
            id="imported-passage"
            value={pending.text}
            onChange={(e) => setPending({ ...pending, text: e.target.value })}
            maxLength={20000}
          />
          <div className="import-actions">
            <button
              className="primary-button"
              onClick={() => {
                const problem = passageError(pending.text);
                if (problem) {
                  setError(problem);
                  return;
                }
                if (split(pending.text)) {
                  setPending(null);
                  onImporting(false);
                }
              }}
            >
              Use passage
            </button>
            <button className="text-button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="phrase-guide" id="phrase-guide">
            One phrase per line. Press Enter where students should have time to
            write. Review the suggested breaks before starting.
          </p>
          <textarea
            id="source-text"
            className="source-text dictation-text"
            aria-describedby="phrase-guide"
            placeholder={
              'Paste a passage, then choose Suggest breaks.\nOr upload a file to get started.'
            }
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={20000}
            readOnly={active || loading}
            spellCheck
          />
        </>
      )}
      {error && (
        <p role="alert" className="import-error">
          {error}
        </p>
      )}
    </>
  );
}
