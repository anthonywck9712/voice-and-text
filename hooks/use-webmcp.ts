'use client';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { wordCount } from '@/lib/text';
type Context = {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function useWebMCP(stage: (text: string) => void) {
  const stageRef = useRef(stage);
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);
  useEffect(() => {
    const context = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'stage_reading_text',
            description:
              'Place text in the visible Text to voice editor. This replaces its text but does not play sound or activate the microphone. The user selects a voice and presses Play.',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string', minLength: 1, maxLength: 20000 },
              },
              required: ['text'],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute(input) {
              if (
                !input ||
                typeof input !== 'object' ||
                Object.keys(input).some((key) => key !== 'text') ||
                !('text' in input) ||
                typeof input.text !== 'string' ||
                !input.text.trim() ||
                input.text.length > 20000
              )
                throw new Error(
                  'Provide text containing 1 to 20,000 characters.',
                );
              const text = input.text;
              flushSync(() => stageRef.current(text));
              return {
                status: 'staged',
                words: wordCount(text),
                characters: text.length,
                playback: 'not started',
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Optional browser capability. The visible app works without it. */
    }
    return () => lifecycle.abort();
  }, []);
}
