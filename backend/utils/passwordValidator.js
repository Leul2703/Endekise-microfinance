/**
 * Password complexity validation utility
 * Ensures passwords meet security requirements
 */

/**
 * Validate password complexity
 * @param {string} password - Password to validate
 * @returns {Array} - Array of error messages (empty if valid)
 */
const validatePasswordComplexity = (password) => {
  const errors = [];
  
  if (!password) {
    errors.push('Password is required');
    return errors;
  }
  
  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  // Check for common weak passwords
  const commonPasswords = ['password', '123456', 'qwerty', 'admin123', 'password123'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    errors.push('Password contains common weak patterns');
  }
  
  return errors;
};

/**
 * Check if password is valid
 * @param {string} password - Password to validate
 * @returns {boolean} - True if password meets all requirements
 */
const isPasswordValid = (password) => {
  return validatePasswordComplexity(password).length === 0;
};

module.exports = {
  validatePasswordComplexity,
  isPasswordValid
};
