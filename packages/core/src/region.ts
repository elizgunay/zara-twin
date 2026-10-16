/**
 * Р22: данните се обработват само в ЕС. Всеки облачен доставчик декларира
 * региона си и системата отказва да тръгне, ако той не е в ЕС.
 *
 * Списъкът е умишлено явен (allowlist): нов регион се добавя съзнателно,
 * след проверка, че наистина е в ЕС.
 */
const EU_REGIONS = new Set([
  // Локална обработка на компютъра на собственика
  "local",
  // Google Cloud
  "eu",
  "europe-west1",
  "europe-west3",
  "europe-west4",
  "europe-west8",
  "europe-west9",
  "europe-north1",
  "europe-central2",
  "europe-southwest1",
  // Speechmatics: eu1 (за всички, партида), eu2 (само за Enterprise), eu (на живо, eu.rt.speechmatics.com)
  "eu1",
  "eu2",
  // Microsoft Azure
  "westeurope",
  "northeurope",
  "germanywestcentral",
  "francecentral",
  "swedencentral",
  "italynorth",
  "polandcentral",
  "spaincentral",
]);

export function isEuRegion(region: string): boolean {
  return EU_REGIONS.has(region.trim().toLowerCase());
}

export function assertEuRegion(providerId: string, region: string): void {
  if (!isEuRegion(region)) {
    throw new Error(
      `Доставчикът "${providerId}" е настроен за регион "${region}", който не е в ЕС (Р22).`,
    );
  }
}
