/**
 * Client-side validation mirrors backend rules for real-time form feedback.
 */

const EMOJI_REGEX = /\p{Extended_Pictographic}/u;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ETHIOPIAN_PHONE_REGEX = /^\+251[79]\d{8}$/;
const FAYDA_NATIONAL_ID_REGEX = /^\d{16}$/;

export const stripEmojis = (value) => String(value || '').replace(/\p{Extended_Pictographic}/gu, '');

export const hasEmoji = (value) => EMOJI_REGEX.test(String(value || ''));

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

export const normalizeEthiopianPhone = (value) => {
  const raw = String(value || '').trim().replace(/\s/g, '');
  if (!raw) return '';

  let digits = digitsOnly(raw);
  if (!digits) return '';

  if (digits.startsWith('251')) {
    // keep
  } else if (digits.startsWith('0')) {
    digits = `251${digits.slice(1)}`;
  } else if (digits.length === 9 && /^[79]/.test(digits)) {
    digits = `251${digits}`;
  }

  if (!digits.startsWith('251') || digits.length !== 12) {
    return raw.startsWith('+') ? raw : '';
  }

  return `+${digits}`;
};

export const formatPhoneInput = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (raw.startsWith('+251')) {
    const rest = digitsOnly(raw.slice(4)).slice(0, 9);
    return `+251${rest}`;
  }

  const normalized = normalizeEthiopianPhone(raw);
  return normalized || raw.replace(/[^\d+]/g, '').slice(0, 13);
};

export const validateEthiopianPhone = (value, { required = true } = {}) => {
  const normalized = normalizeEthiopianPhone(value);
  if (!normalized) {
    if (required && String(value || '').trim()) {
      return 'Use Ethiopian format +2519XXXXXXXX (e.g. +251912345678)';
    }
    if (required) return 'Phone number is required';
    return '';
  }
  if (!ETHIOPIAN_PHONE_REGEX.test(normalized)) {
    return 'Phone must be +251 followed by 9 digits starting with 7 or 9';
  }
  return '';
};

export const validateEmail = (value, { required = true } = {}) => {
  const email = String(value || '').trim().toLowerCase();
  if (!email) {
    return required ? 'Email is required' : '';
  }
  if (!EMAIL_REGEX.test(email)) {
    return 'Enter a valid email address';
  }
  if (hasEmoji(email)) {
    return 'Emoji characters are not allowed';
  }
  return '';
};

export const validateEthiopianNationalId = (idNumber, idType = 'National ID') => {
  const type = String(idType || '').trim();
  const raw = String(idNumber || '').trim();

  if (!raw) return 'ID number is required';
  if (hasEmoji(raw)) return 'Emoji characters are not allowed';

  if (type === 'National ID' || type === 'Fayda ID') {
    const digits = digitsOnly(raw);
    if (!FAYDA_NATIONAL_ID_REGEX.test(digits)) {
      return 'Ethiopian National ID must be exactly 16 digits';
    }
    if (/^(\d)\1{15}$/.test(digits)) {
      return 'National ID number appears invalid';
    }
    return '';
  }

  if (type === 'Passport') {
    if (!/^[A-Za-z0-9]{6,12}$/.test(raw)) {
      return 'Passport number must be 6-12 alphanumeric characters';
    }
    return '';
  }

  if (raw.length < 4) return 'ID number is too short';
  return '';
};

export const validatePasswordStrength = (password) => {
  const errors = [];
  const value = String(password || '');

  if (!value) {
    return ['Password is required'];
  }
  if (value.length < 12) errors.push('At least 12 characters');
  if (!/[a-z]/.test(value)) errors.push('One lowercase letter');
  if (!/[A-Z]/.test(value)) errors.push('One uppercase letter');
  if (!/[0-9]/.test(value)) errors.push('One number');
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) errors.push('One special character');

  const common = ['password', '123456', 'qwerty', 'admin123', 'password123'];
  if (common.some((c) => value.toLowerCase().includes(c))) {
    errors.push('Avoid common weak patterns');
  }

  return errors;
};

export const validateRegistrationForm = (form, { idTypeField = 'id_type' } = {}) => {
  const errors = {};

  if (!String(form.full_name || form.name || '').trim()) {
    errors.full_name = 'Full name is required';
  }

  const emailErr = validateEmail(form.email);
  if (emailErr) errors.email = emailErr;

  const phoneErr = validateEthiopianPhone(form.phone);
  if (phoneErr) errors.phone = phoneErr;

  const idErr = validateEthiopianNationalId(form.id_number || form.idNumber, form[idTypeField] || form.id_type);
  if (idErr) errors.id_number = idErr;

  return errors;
};
