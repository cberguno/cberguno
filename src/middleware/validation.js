/**
 * @fileoverview Validation middleware for request validation using Joi
 * @author API Documentation Generator
 * @version 1.0.0
 */

const Joi = require('joi');

/**
 * Middleware factory to validate request data against a Joi schema
 * @param {Object} schema - Joi schema object
 * @param {string} property - Request property to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 * 
 * @example
 * // Usage in routes
 * const userSchema = Joi.object({
 *   email: Joi.string().email().required(),
 *   password: Joi.string().min(6).required()
 * });
 * 
 * router.post('/users', validateRequest(userSchema), (req, res) => {
 *   // req.body is validated
 * });
 */
const validateRequest = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: false
    });

    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: 'The request data is invalid',
        validationErrors: errorDetails
      });
    }

    // Replace the original property with the validated and sanitized value
    req[property] = value;
    next();
  };
};

/**
 * Middleware to validate request body
 * @param {Object} schema - Joi schema object
 * @returns {Function} Express middleware function
 */
const validateBody = (schema) => validateRequest(schema, 'body');

/**
 * Middleware to validate query parameters
 * @param {Object} schema - Joi schema object
 * @returns {Function} Express middleware function
 */
const validateQuery = (schema) => validateRequest(schema, 'query');

/**
 * Middleware to validate route parameters
 * @param {Object} schema - Joi schema object
 * @returns {Function} Express middleware function
 */
const validateParams = (schema) => validateRequest(schema, 'params');

/**
 * Global error handling middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {void}
 */
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const validationErrors = Object.values(err.errors).map(error => ({
      field: error.path,
      message: error.message,
      value: error.value
    }));

    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: 'The request data is invalid',
      validationErrors
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({
      success: false,
      error: 'Duplicate entry',
      details: `${field} already exists`,
      field: field,
      value: err.keyValue[field]
    });
  }

  // Mongoose cast error
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: 'Invalid ID format',
      details: 'The provided ID is not valid'
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'Invalid token',
      details: 'The provided token is malformed or invalid'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'Token expired',
      details: 'The provided token has expired. Please login again'
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    details: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : err.stack
  });
};

/**
 * Middleware to handle 404 errors for undefined routes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {void}
 */
const notFound = (req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

/**
 * Middleware to validate MongoDB ObjectId
 * @param {string} paramName - Name of the parameter containing the ObjectId
 * @returns {Function} Express middleware function
 * 
 * @example
 * // Usage in routes
 * router.get('/users/:id', validateObjectId('id'), (req, res) => {
 *   // req.params.id is guaranteed to be a valid ObjectId
 * });
 */
const validateObjectId = (paramName = 'id') => {
  return (req, res, next) => {
    const id = req.params[paramName];
    
    if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID format',
        details: `The ${paramName} parameter must be a valid MongoDB ObjectId`
      });
    }

    next();
  };
};

/**
 * Middleware to validate pagination parameters
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {void}
 */
const validatePagination = (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;

  if (page < 1) {
    return res.status(400).json({
      success: false,
      error: 'Invalid page number',
      details: 'Page number must be greater than 0'
    });
  }

  if (limit < 1 || limit > 100) {
    return res.status(400).json({
      success: false,
      error: 'Invalid limit',
      details: 'Limit must be between 1 and 100'
    });
  }

  req.pagination = { page, limit };
  next();
};

module.exports = {
  validateRequest,
  validateBody,
  validateQuery,
  validateParams,
  validateObjectId,
  validatePagination,
  errorHandler,
  notFound
};