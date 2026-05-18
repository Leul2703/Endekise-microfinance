/**
 * Shared input validation for registration and profile updates.
 */

const EMOJI_REGEX = /\p{Extended_Pictographic}/u;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ETHIOPIAN_PHONE_REGEX = /^\+251[79]\d{8}$/;
const FAYDA_NATIONAL_ID_REGEX = /^\d{16}$/;

const hasEmoji = (value) => EMOJI_REGEX.test(String(value || ''));

const stripEmojis = (value) => String(value || '').replace(/\p{Extended_Pictographic}/gu, '');

const normalizeText = (value) => stripEmojis(value).trim();

const normalizeEmail = (value) => normalizeText(value).toLowerCase();

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

/**
 * Normalize Ethiopian mobile numbers to +2519XXXXXXXX format.
 */
const normalizeEthiopianPhone = (value) => {
  const raw = normalizeText(value);
  if (!raw) return null;

  let digits = digitsOnly(raw);
  if (!digits) return null;

  if (digits.startsWith('251')) {
    // already international without +
  } else if (digits.startsWith('0') && digits.length >= 10) {
    digits = `251${digits.slice(1)}`;
  } else if (digits.length === 9 && /^[79]/.test(digits)) {
    digits = `251${digits}`;
  } else if (digits.length === 10 && digits.startsWith('0')) {
    digits = `251${digits.slice(1)}`;
  }

  if (!digits.startsWith('251') || digits.length !== 12) {
    return null;
  }

  return `+${digits}`;
};

const validateEthiopianPhone = (value, { required = true } = {}) => {
  const errors = [];
  const normalized = normalizeEthiopianPhone(value);

  if (!normalized) {
    if (required && normalizeText(value)) {
      errors.push('Phone must be a valid Ethiopian mobile number in +251 format (e.g. +251912345678)');
    } else if (required) {
      errors.push('Phone number is required');
    }
    return { errors, normalized: null };
  }

  if (!ETHIOPIAN_PHONE_REGEX.test(normalized)) {
    errors.push('Phone must use Ethiopian format +251 followed by 9 digits starting with 7 or 9');
  }

  return { errors, normalized };
};

const validateEmail = (value, { required = true } = {}) => {
  const errors = [];
  const normalized = normalizeEmail(value);

  if (!normalized) {
    if (required) errors.push('Email is required');
    return { errors, normalized: null };
  }

  if (!EMAIL_REGEX.test(normalized)) {
    errors.push('A valid email address is required');
  }

  if (hasEmoji(normalized)) {
    errors.push('Emoji characters are not allowed in email');
  }

  return { errors, normalized };
};

const normalizeNationalId = (value) => digitsOnly(value);

/**
 * Ethiopian Fayda National ID: 16 digits.
 */
const validateEthiopianNationalId = (idNumber, idType = 'National ID') => {
  const errors = [];
  const normalizedType = normalizeText(idType);
  const raw = normalizeText(idNumber);

  if (!raw) {
    errors.push('ID number is required');
    return { errors, normalized: null };
  }

  if (hasEmoji(raw)) {
    errors.push('Emoji characters are not allowed in ID number');
    return { errors, normalized: null };
  }

  if (normalizedType === 'National ID' || normalizedType === 'Fayda ID') {
    const digits = normalizeNationalId(raw);
    if (!FAYDA_NATIONAL_ID_REGEX.test(digits)) {
      errors.push('Ethiopian National ID must be exactly 16 digits');
    }
    if (/^(\d)\1{15}$/.test(digits)) {
      errors.push('National ID number appears invalid');
    }
    return { errors, normalized: digits };
  }

  if (normalizedType === 'Passport') {
    if (!/^[A-Za-z0-9]{6,12}$/.test(raw)) {
      errors.push('Passport number must be 6-12 alphanumeric characters');
    }
    return { errors, normalized: raw.toUpperCase() };
  }

  if (raw.length < 4 || raw.length > 32) {
    errors.push('ID number must be between 4 and 32 characters');
  }

  return { errors, normalized: raw };
};

const validateNoEmojiFields = (fields) => {
  const errors = [];
  Object.entries(fields).forEach(([label, value]) => {
    if (value && hasEmoji(value)) {
      errors.push(`Emoji characters are not allowed in ${label}`);
    }
  });
  return errors;
};

const validateClientRegistrationFields = (payload, { requirePassword = false, password = null } = {}) => {
  const errors = [];
  const idType = payload.id_type || payload.idType || 'National ID';

  const emailResult = validateEmail(payload.email, { required: true });
  const phoneResult = validateEthiopianPhone(payload.phone, { required: true });
  const idResult = validateEthiopianNationalId(payload.id_number || payload.idNumber, idType);

  errors.push(...emailResult.errors, ...phoneResult.errors, ...idResult.errors);
  errors.push(...validateNoEmojiFields({
    name: payload.full_name || payload.name,
    address: payload.address,
    income_source: payload.income_source || payload.incomeSource,
    subject: payload.subject
  }));

  if (requirePassword && password) {
    const { validatePasswordComplexity } = require('./passwordValidator');
    errors.push(...validatePasswordComplexity(password));
  }

  return {
    errors: [...new Set(errors)],
    normalized: {
      email: emailResult.normalized,
      phone: phoneResult.normalized,
      id_number: idResult.normalized
    }
  };
};

module.exports = {
  EMOJI_REGEX,
  EMAIL_REGEX,
  ETHIOPIAN_PHONE_REGEX,
  FAYDA_NATIONAL_ID_REGEX,
  hasEmoji,
  stripEmojis,
  normalizeText,
  normalizeEmail,
  normalizeEthiopianPhone,
  normalizeNationalId,
  validateEthiopianPhone,
  validateEmail,
  validateEthiopianNationalId,
  validateNoEmojiFields,
  validateClientRegistrationFields
};
