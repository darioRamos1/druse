import { formatBytes, formatDuration } from './report-history';

describe('formatBytes y formatDuration', () => {
  it('elige la unidad que se lee de un vistazo', () => {
    expect(formatBytes(0)).toMatch(/^0\s*(byte|B)/);
    expect(formatBytes(2048)).toMatch(/^2\s*kB/i);
    expect(formatBytes(512 * 1024 * 1024)).toMatch(/^512\s*MB/);
    expect(formatBytes(1.5 * 1024 ** 3)).toMatch(/^1[,.]5\s*GB/);
  });

  it('cuenta segundos y, desde el minuto, minutos', () => {
    expect(formatDuration('2026-11-12T09:00:00Z', '2026-11-12T09:00:02.5Z')).toMatch(/^2[,.]5\s*s/);
    expect(formatDuration('2026-11-12T09:00:00Z', '2026-11-12T09:01:30Z')).toMatch(/^1[,.]5\s*min/);
  });
});
