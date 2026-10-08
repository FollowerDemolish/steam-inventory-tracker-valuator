// Steam wallet currencies Glasscase supports, with Steam's numeric ids and
// whether Skinport's public API can quote in them.

export const CURRENCIES = Object.freeze([
  { code: 'USD', steamId: 1, name: 'US dollar', locale: 'en-US', skinport: true },
  { code: 'GBP', steamId: 2, name: 'British pound', locale: 'en-GB', skinport: true },
  { code: 'EUR', steamId: 3, name: 'Euro', locale: 'de-DE', skinport: true },
  { code: 'CHF', steamId: 4, name: 'Swiss franc', locale: 'de-CH', skinport: true },
  { code: 'RUB', steamId: 5, name: 'Russian ruble', locale: 'ru-RU', skinport: true },
  { code: 'PLN', steamId: 6, name: 'Polish zloty', locale: 'pl-PL', skinport: true },
  { code: 'BRL', steamId: 7, name: 'Brazilian real', locale: 'pt-BR', skinport: true },
  { code: 'NOK', steamId: 9, name: 'Norwegian krone', locale: 'nb-NO', skinport: true },
  { code: 'IDR', steamId: 10, name: 'Indonesian rupiah', locale: 'id-ID', skinport: false },
  { code: 'MYR', steamId: 11, name: 'Malaysian ringgit', locale: 'ms-MY', skinport: false },
  { code: 'PHP', steamId: 12, name: 'Philippine peso', locale: 'en-PH', skinport: false },
  { code: 'SGD', steamId: 13, name: 'Singapore dollar', locale: 'en-SG', skinport: false },
  { code: 'THB', steamId: 14, name: 'Thai baht', locale: 'th-TH', skinport: false },
  { code: 'VND', steamId: 15, name: 'Vietnamese dong', locale: 'vi-VN', skinport: false },
  { code: 'KRW', steamId: 16, name: 'South Korean won', locale: 'ko-KR', skinport: false },
  { code: 'TRY', steamId: 17, name: 'Turkish lira', locale: 'tr-TR', skinport: true },
  { code: 'UAH', steamId: 18, name: 'Ukrainian hryvnia', locale: 'uk-UA', skinport: false },
  { code: 'MXN', steamId: 19, name: 'Mexican peso', locale: 'es-MX', skinport: false },
  { code: 'CAD', steamId: 20, name: 'Canadian dollar', locale: 'en-CA', skinport: true },
  { code: 'AUD', steamId: 21, name: 'Australian dollar', locale: 'en-AU', skinport: true },
  { code: 'NZD', steamId: 22, name: 'New Zealand dollar', locale: 'en-NZ', skinport: false },
  { code: 'CNY', steamId: 23, name: 'Chinese yuan', locale: 'zh-CN', skinport: true },
  { code: 'INR', steamId: 24, name: 'Indian rupee', locale: 'en-IN', skinport: false },
  { code: 'KZT', steamId: 37, name: 'Kazakhstani tenge', locale: 'kk-KZ', skinport: false },
]);

export function currencyByCode(code) {
  return CURRENCIES.find((c) => c.code === String(code).toUpperCase()) ?? CURRENCIES[0];
}

// Fixed, approximate rates used only to convert the offline demo snapshot
// (which is priced in USD). Live scans always ask the marketplace for the
// selected currency and never use these.
export const DEMO_RATES = Object.freeze({
  USD: 1, GBP: 0.77, EUR: 0.86, CHF: 0.8, RUB: 81, PLN: 3.65, BRL: 5.4, NOK: 10.1,
  IDR: 16400, MYR: 4.2, PHP: 58, SGD: 1.3, THB: 32.5, VND: 26200, KRW: 1420, TRY: 42,
  UAH: 41.6, MXN: 18.4, CAD: 1.4, AUD: 1.52, NZD: 1.74, CNY: 7.12, INR: 88, KZT: 540,
});
