import { localTimeZone, timeZoneChoices } from './report-schedule';

describe('timeZoneChoices', () => {
  it('pone primero la zona del equipo y UTC, sin repetir ninguna', () => {
    const zones = timeZoneChoices(null);

    expect(zones[0]).toBe(localTimeZone());
    expect(zones).toContain('UTC');
    expect(new Set(zones).size).toBe(zones.length);
  });

  it('conserva la zona guardada aunque el navegador no la liste', () => {
    expect(timeZoneChoices('Etc/GMT+5')).toContain('Etc/GMT+5');
  });
});
