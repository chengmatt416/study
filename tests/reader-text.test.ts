import { describe, expect, it, vi } from 'vitest';
import { readPdfPageText } from '../src/web/features/reader/text-content';
import type { PDFPageProxy } from '../src/web/features/reader/pdf';
const page = (stream: ReadableStream) => ({ streamTextContent: () => stream }) as Pick<PDFPageProxy, 'streamTextContent'>;
describe('PDF text streams on browsers without stream async iteration', () => {
  it('reads all chunks in order without relying on Symbol.asyncIterator', async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue({ items: [{ str: 'Mass' }, { str: 'changes' }] }); controller.enqueue({ items: [{ str: 'period' }, { type: 'marked-content' }] }); controller.close(); } });
    Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined });
    expect(await readPdfPageText(page(stream))).toBe('Mass changes period '); expect(stream.locked).toBe(false);
  });
  it('cancels the actual stream and releases the reader when a search is stopped', async () => {
    const cancel = vi.fn(), controller = new AbortController();
    const stream = new ReadableStream({ pull() {}, cancel });
    const result = readPdfPageText(page(stream), controller.signal); controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' }); expect(cancel).toHaveBeenCalled(); expect(stream.locked).toBe(false);
  });
  it('propagates extraction errors without leaving a stream reader locked', async () => {
    const stream = new ReadableStream({ start(controller) { controller.error(Error('text extraction interrupted')); } });
    await expect(readPdfPageText(page(stream))).rejects.toThrow('text extraction interrupted'); expect(stream.locked).toBe(false);
  });
});
