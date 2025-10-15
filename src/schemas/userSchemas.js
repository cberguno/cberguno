/**
 * @fileoverview Joi validation schemas for user management endpoints
 * @author API Documentation Generator
 * @version 1.0.0
 */

const Joi = require('joi');

/**
 * Schema for updating user profile validation
 * @type {Joi.ObjectSchema}
 */
const updateUserSchema = Joi.object({
  firstName: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z\s'-]+$/)
    .optional()
    .messages({
      'string.min': 'First name must be at least 2 characters long',
      'string.max': 'First name cannot exceed 50 characters',
      'string.pattern.base': 'First name can only contain letters, spaces, hyphens, and apostrophes'
    }),
  lastName: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z\s'-]+$/)
    .optional()
    .messages({
      'string.min': 'Last name must be at least 2 characters long',
      'string.max': 'Last name cannot exceed 50 characters',
      'string.pattern.base': 'Last name can only contain letters, spaces, hyphens, and apostrophes'
    }),
  email: Joi.string()
    .email({ tlds: { allow: false } })
    .optional()
    .messages({
      'string.email': 'Please provide a valid email address'
    })
}).min(1).messages({
  'object.min': 'At least one field must be provided for update'
});

/**
 * Schema for changing user password validation
 * @type {Joi.ObjectSchema}
 */
const changePasswordSchema = Joi.object({
  currentPassword: Joi.string()
    .required()
    .messages({
      'any.required': 'Current password is required'
    }),
  newPassword: Joi.string()
    .min(6)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required()
    .messages({
      'string.min': 'New password must be at least 6 characters long',
      'string.max': 'New password cannot exceed 128 characters',
      'string.pattern.base': 'New password must contain at least one lowercase letter, one uppercase letter, and one number',
      'any.required': 'New password is required'
    }),
  confirmPassword: Joi.string()
    .valid(Joi.ref('newPassword'))
    .required()
    .messages({
      'any.only': 'Confirm password must match new password',
      'any.required': 'Confirm password is required'
    })
});

/**
 * Schema for user query parameters validation
 * @type {Joi.ObjectSchema}
 */
const userQuerySchema = Joi.object({
  page: Joi.number()
    .integer()
    .min(1)
    .default(1)
    .messages({
      'number.base': 'Page must be a number',
      'number.integer': 'Page must be an integer',
      'number.min': 'Page must be at least 1'
    }),
  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(10)
    .messages({
      'number.base': 'Limit must be a number',
      'number.integer': 'Limit must be an integer',
      'number.min': 'Limit must be at least 1',
      'number.max': 'Limit cannot exceed 100'
    }),
  search: Joi.string()
    .min(2)
    .max(100)
    .optional()
    .messages({
      'string.min': 'Search term must be at least 2 characters long',
      'string.max': 'Search term cannot exceed 100 characters'
    }),
  role: Joi.string()
    .valid('user', 'admin')
    .optional()
    .messages({
      'any.only': 'Role must be either "user" or "admin"'
    }),
  isActive: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'isActive must be a boolean value'
    }),
  sortBy: Joi.string()
    .valid('firstName', 'lastName', 'email', 'createdAt', 'updatedAt')
    .default('createdAt')
    .messages({
      'any.only': 'Sort field must be one of: firstName, lastName, email, createdAt, updatedAt'
    }),
  sortOrder: Joi.string()
    .valid('asc', 'desc')
    .default('desc')
    .messages({
      'any.only': 'Sort order must be either "asc" or "desc"'
    })
});

/**
 * Schema for updating user role validation (Admin only)
 * @type {Joi.ObjectSchema}
 */
const updateUserRoleSchema = Joi.object({
  role: Joi.string()
    .valid('user', 'admin')
    .required()
    .messages({
      'any.only': 'Role must be either "user" or "admin"',
      'any.required': 'Role is required'
    })
});

/**
 * Schema for updating user status validation (Admin only)
 * @type {Joi.ObjectSchema}
 */
const updateUserStatusSchema = Joi.object({
  isActive: Joi.boolean()
    .required()
    .messages({
      'boolean.base': 'isActive must be a boolean value',
      'any.required': 'isActive is required'
    })
});

/**
 * Schema for bulk user operations validation (Admin only)
 * @type {Joi.ObjectSchema}
 */
const bulkUserOperationSchema = Joi.object({
  userIds: Joi.array()
    .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
    .min(1)
    .max(100)
    .required()
    .messages({
      'array.min': 'At least one user ID must be provided',
      'array.max': 'Cannot process more than 100 users at once',
      'any.required': 'User IDs are required'
    }),
  operation: Joi.string()
    .valid('activate', 'deactivate', 'delete')
    .required()
    .messages({
      'any.only': 'Operation must be one of: activate, deactivate, delete',
      'any.required': 'Operation is required'
    })
});

/**
 * Schema for user preferences validation
 * @type {Joi.ObjectSchema}
 */
const userPreferencesSchema = Joi.object({
  emailNotifications: Joi.boolean()
    .default(true)
    .messages({
      'boolean.base': 'Email notifications must be a boolean value'
    }),
  smsNotifications: Joi.boolean()
    .default(false)
    .messages({
      'boolean.base': 'SMS notifications must be a boolean value'
    }),
  newsletter: Joi.boolean()
    .default(true)
    .messages({
      'boolean.base': 'Newsletter subscription must be a boolean value'
    }),
  language: Joi.string()
    .valid('en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko')
    .default('en')
    .messages({
      'any.only': 'Language must be one of the supported language codes'
    }),
  timezone: Joi.string()
    .max(50)
    .default('UTC')
    .messages({
      'string.max': 'Timezone cannot exceed 50 characters'
    }),
  dateFormat: Joi.string()
    .valid('MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD')
    .default('MM/DD/YYYY')
    .messages({
      'any.only': 'Date format must be one of: MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD'
    })
});

module.exports = {
  updateUserSchema,
  changePasswordSchema,
  userQuerySchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
  bulkUserOperationSchema,
  userPreferencesSchema
};