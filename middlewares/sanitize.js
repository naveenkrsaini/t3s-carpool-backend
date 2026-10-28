// middlewares/sanitize.js

/**
 * Malicious HTML tags aur XSS scripts ko sanitize karein
 */
const cleanString = (val) => {
  if (typeof val !== 'string') return val;
  return val
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/[<>]/g, '');
};

const sanitizeInput = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = cleanString(req.body[key]);
      }
    }
  }
  next();
};

module.exports = { sanitizeInput };