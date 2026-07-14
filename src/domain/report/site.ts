const TEMPLATE_SITE_PATTERN = /^[DEMPS0-9: -]*$/;

export const normalizeSite = (input: string): string => input.trim().toUpperCase();
export const isValidSite = (input: string): boolean =>
  TEMPLATE_SITE_PATTERN.test(normalizeSite(input));
