const crypto = require('crypto');

/**
 * Generate UUID v4
 * Used for non-sequential, globally unique identifiers
 * Prevents ID enumeration attacks
 * @returns {string} UUID v4 string
 */
const generateUUID = () => {
  return crypto.randomUUID();
};

/**
 * Generate prefixed UUID for specific entity types
 * @param {string} prefix - Entity prefix (e.g., 'LOAN', 'SAV', 'TRX')
 * @returns {string} Prefixed UUID (e.g., 'LOAN-123e4567-e89b-12d3-a456-426614174000')
 */
const generatePrefixedUUID = (prefix) => {
  const uuid = crypto.randomUUID();
  return `${prefix}-${uuid}`;
};

/**
 * Generate cryptographically secure random string
 * @param {number} length - Length of the random string
 * @returns {string} Random hex string
 */
const generateRandomString = (length = 32) => {
  return crypto.randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
};

module.exports = {
  generateUUID,
  generatePrefixedUUID,
  generateRandomString
};
