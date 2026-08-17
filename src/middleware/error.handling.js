// src/middleware/error.handling.js
import { logger } from '../utils/logger.js';

export const errorHandler = (err, req, res, next) => {
  logger.error({
    event: 'unhandled_exception',
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });

  return res.status(err.statusCode || 500).json({
    status: 'FAIL',
    error: err.code || 'INTERNAL_SERVER_ERROR',
    message: err.message || 'Unexpected server error',
  });
};