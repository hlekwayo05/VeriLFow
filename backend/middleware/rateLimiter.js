'use strict';

const rateLimit = require('express-rate-limit');

function createLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many requests. Please try again later.',
    },
  });
}

const adminActionLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
});

const studentImportLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
});

const passwordResetLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
});

const supportLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
});

const messageLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
});

const broadcastLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
});

const uploadLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
});

module.exports = {
  adminActionLimiter,
  studentImportLimiter,
  passwordResetLimiter,
  supportLimiter,
  messageLimiter,
  broadcastLimiter,
  uploadLimiter,
};
