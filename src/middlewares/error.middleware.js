import { AppError } from '../utils/AppError.js';

/**
 * Handle Mongoose CastError (Invalid ObjectId)
 */
const handleCastErrorDB = (err) => {
  return new AppError(`Invalid ${err.path}: ${err.value}`, 400);
};

/**
 * Handle Mongoose Duplicate Key Error
 */
const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];
  return new AppError(
    `Duplicate value '${value}' for field '${field}'. Please use another value.`,
    409
  );
};

/**
 * Handle Mongoose Validation Error
 */
const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((e) => ({
    field: e.path,
    message: e.message,
  }));
  return new AppError('Validation failed', 400, errors);
};

/**
 * Handle JWT Invalid Token Error
 */
const handleJWTError = () => {
  return new AppError('Invalid token. Please log in again.', 401);
};

/**
 * Handle JWT Expired Token Error
 */
const handleJWTExpiredError = () => {
  return new AppError('Token expired. Please log in again.', 401);
};

/**
 * Handle Zod Validation Error
 */
const handleZodError = (err) => {
  const errors = err.errors.map((e) => ({
    field: e.path.join('.'),
    message: e.message,
  }));
  return new AppError('Validation failed', 400, errors);
};

/**
 * Send error response in development
 * Includes full error details and stack trace
 */
const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    success: false,
    status: err.status,
    message: err.message,
    errors: err.errors || null,
    stack: err.stack,
    error: err,
  });
};

/**
 * Send error response in production
 * Only includes safe information for operational errors
 */
const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      status: err.status,
      message: err.message,
      errors: err.errors || null,
    });
  } else {
    // Programming or unknown error: don't leak details
    console.error('ERROR:', err);

    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Something went wrong. Please try again later.',
    });
  }
};

/**
 * Global Error Handler Middleware
 * Catches all errors and sends appropriate response
 */
const errorMiddleware = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    // Normalize Mongoose ValidationError to 400 in dev mode too — a 500 for a
    // validation failure (negative amount, bad enum) is misleading even in dev.
    // We still emit the original stack trace so debugging is unaffected.
    if (err.name === 'ValidationError') {
      const normalized = handleValidationErrorDB(err);
      return res.status(400).json({
        success: false,
        status: normalized.status,
        message: normalized.message,
        errors: normalized.errors || null,
        stack: err.stack,
      });
    }
    sendErrorDev(err, res);
  } else {
    // Create a copy to avoid modifying original error
    let error = Object.assign(Object.create(Object.getPrototypeOf(err)), err);
    error.message = err.message;

    // Handle specific error types
    if (err.name === 'CastError') error = handleCastErrorDB(err);
    if (err.code === 11000) error = handleDuplicateFieldsDB(err);
    if (err.name === 'ValidationError') error = handleValidationErrorDB(err);
    if (err.name === 'JsonWebTokenError') error = handleJWTError();
    if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();
    if (err.name === 'ZodError') error = handleZodError(err);

    sendErrorProd(error, res);
  }
};

export default errorMiddleware;
