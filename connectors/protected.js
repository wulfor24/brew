// Brands whose live connections are never dropped or replaced by accident (a client going live): PROTECTED_CONNECTIONS,
// default arata-in. Read by the connector routes (connectors/index.js) and the vault (vault.js, the last line).
export const PROTECTED = () => new Set(String(process.env.PROTECTED_CONNECTIONS ?? 'arata-in').split(',').map((x) => x.trim()).filter(Boolean));
export const isProtected = (slug) => PROTECTED().has(String(slug || ''));
