import { Console } from 'node:console';
import { Transform } from 'node:stream';

const ts = new Transform({ transform: (chunk, _, cb) => cb(null, chunk) });
const logger = new Console({ stdout: ts, stderr: ts, colorMode: false });
const handler = {
  get(_, prop) {
    return new Proxy(logger[prop], handler);
  },
  apply(target, _, args) {
    target.apply(logger, args);
    return (ts.read() || '').toString();
  },
};

const dumper = new Proxy(logger, handler);

export type TableParameters = Parameters<(typeof dumper)['table']>;

export function table(...parameters: TableParameters): string {
  const original = dumper.table(...parameters);

  // Tables should all start with roughly:
  // ┌─────────┬──────
  // │ (index) │
  // ├─────────┼
  const columnWidth = original.indexOf('┬─');

  const trimmed = original
    .split('\n')
    .map((line) => line.slice(columnWidth))
    .join('\n');

  return '┌' + trimmed.slice(1);
}
