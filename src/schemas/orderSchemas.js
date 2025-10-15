/**
 * @fileoverview Joi validation schemas for order management endpoints
 * @author API Documentation Generator
 * @version 1.0.0
 */

const Joi = require('joi');

/**
 * Schema for creating a new order validation
 * @type {Joi.ObjectSchema}
 */
const createOrderSchema = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        productId: Joi.string()
          .pattern(/^[0-9a-fA-F]{24}$/)
          .required()
          .messages({
            'string.pattern.base': 'Product ID must be a valid MongoDB ObjectId',
            'any.required': 'Product ID is required'
          }),
        quantity: Joi.number()
          .integer()
          .min(1)
          .max(999)
          .required()
          .messages({
            'number.base': 'Quantity must be a number',
            'number.integer': 'Quantity must be an integer',
            'number.min': 'Quantity must be at least 1',
            'number.max': 'Quantity cannot exceed 999',
            'any.required': 'Quantity is required'
          })
      })
    )
    .min(1)
    .max(50)
    .required()
    .messages({
      'array.min': 'At least one item must be provided',
      'array.max': 'Cannot order more than 50 different items',
      'any.required': 'Order items are required'
    }),
  shippingAddress: Joi.object({
    street: Joi.string()
      .min(5)
      .max(100)
      .required()
      .messages({
        'string.min': 'Street address must be at least 5 characters long',
        'string.max': 'Street address cannot exceed 100 characters',
        'any.required': 'Street address is required'
      }),
    city: Joi.string()
      .min(2)
      .max(50)
      .required()
      .messages({
        'string.min': 'City must be at least 2 characters long',
        'string.max': 'City cannot exceed 50 characters',
        'any.required': 'City is required'
      }),
    state: Joi.string()
      .min(2)
      .max(50)
      .required()
      .messages({
        'string.min': 'State must be at least 2 characters long',
        'string.max': 'State cannot exceed 50 characters',
        'any.required': 'State is required'
      }),
    zipCode: Joi.string()
      .pattern(/^\d{5}(-\d{4})?$/)
      .required()
      .messages({
        'string.pattern.base': 'ZIP code must be in format 12345 or 12345-6789',
        'any.required': 'ZIP code is required'
      }),
    country: Joi.string()
      .length(2)
      .pattern(/^[A-Z]{2}$/)
      .required()
      .messages({
        'string.length': 'Country must be a 2-letter country code',
        'string.pattern.base': 'Country must be uppercase letters only',
        'any.required': 'Country is required'
      })
  }).required().messages({
    'any.required': 'Shipping address is required'
  }),
  paymentMethod: Joi.string()
    .valid('credit_card', 'debit_card', 'paypal', 'bank_transfer', 'cash_on_delivery')
    .required()
    .messages({
      'any.only': 'Payment method must be one of: credit_card, debit_card, paypal, bank_transfer, cash_on_delivery',
      'any.required': 'Payment method is required'
    }),
  notes: Joi.string()
    .max(500)
    .optional()
    .messages({
      'string.max': 'Notes cannot exceed 500 characters'
    })
});

/**
 * Schema for updating order status validation
 * @type {Joi.ObjectSchema}
 */
const updateOrderStatusSchema = Joi.object({
  status: Joi.string()
    .valid('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')
    .required()
    .messages({
      'any.only': 'Status must be one of: pending, confirmed, processing, shipped, delivered, cancelled',
      'any.required': 'Status is required'
    }),
  trackingNumber: Joi.string()
    .min(5)
    .max(50)
    .pattern(/^[A-Z0-9-]+$/)
    .optional()
    .messages({
      'string.min': 'Tracking number must be at least 5 characters long',
      'string.max': 'Tracking number cannot exceed 50 characters',
      'string.pattern.base': 'Tracking number can only contain uppercase letters, numbers, and hyphens'
    }),
  notes: Joi.string()
    .max(500)
    .optional()
    .messages({
      'string.max': 'Notes cannot exceed 500 characters'
    }),
  estimatedDelivery: Joi.date()
    .greater('now')
    .optional()
    .messages({
      'date.greater': 'Estimated delivery must be in the future'
    })
});

/**
 * Schema for order query parameters validation
 * @type {Joi.ObjectSchema}
 */
const orderQuerySchema = Joi.object({
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
  status: Joi.string()
    .valid('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')
    .optional()
    .messages({
      'any.only': 'Status must be one of: pending, confirmed, processing, shipped, delivered, cancelled'
    }),
  paymentStatus: Joi.string()
    .valid('pending', 'paid', 'failed', 'refunded')
    .optional()
    .messages({
      'any.only': 'Payment status must be one of: pending, paid, failed, refunded'
    }),
  startDate: Joi.date()
    .iso()
    .optional()
    .messages({
      'date.format': 'Start date must be in ISO format (YYYY-MM-DD)'
    }),
  endDate: Joi.date()
    .iso()
    .min(Joi.ref('startDate'))
    .optional()
    .messages({
      'date.format': 'End date must be in ISO format (YYYY-MM-DD)',
      'date.min': 'End date must be after start date'
    }),
  minTotal: Joi.number()
    .positive()
    .max(999999.99)
    .precision(2)
    .optional()
    .messages({
      'number.positive': 'Minimum total must be a positive number',
      'number.max': 'Minimum total cannot exceed $999,999.99',
      'number.precision': 'Minimum total can have at most 2 decimal places'
    }),
  maxTotal: Joi.number()
    .positive()
    .max(999999.99)
    .precision(2)
    .optional()
    .messages({
      'number.positive': 'Maximum total must be a positive number',
      'number.max': 'Maximum total cannot exceed $999,999.99',
      'number.precision': 'Maximum total can have at most 2 decimal places'
    }),
  sortBy: Joi.string()
    .valid('createdAt', 'updatedAt', 'total', 'status', 'orderNumber')
    .default('createdAt')
    .messages({
      'any.only': 'Sort field must be one of: createdAt, updatedAt, total, status, orderNumber'
    }),
  sortOrder: Joi.string()
    .valid('asc', 'desc')
    .default('desc')
    .messages({
      'any.only': 'Sort order must be either "asc" or "desc"'
    })
});

/**
 * Schema for order cancellation validation
 * @type {Joi.ObjectSchema}
 */
const cancelOrderSchema = Joi.object({
  reason: Joi.string()
    .min(10)
    .max(500)
    .required()
    .messages({
      'string.min': 'Cancellation reason must be at least 10 characters long',
      'string.max': 'Cancellation reason cannot exceed 500 characters',
      'any.required': 'Cancellation reason is required'
    }),
  refundRequested: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'Refund requested must be a boolean value'
    })
});

/**
 * Schema for order refund validation
 * @type {Joi.ObjectSchema}
 */
const refundOrderSchema = Joi.object({
  amount: Joi.number()
    .positive()
    .max(999999.99)
    .precision(2)
    .optional()
    .messages({
      'number.positive': 'Refund amount must be a positive number',
      'number.max': 'Refund amount cannot exceed $999,999.99',
      'number.precision': 'Refund amount can have at most 2 decimal places'
    }),
  reason: Joi.string()
    .min(10)
    .max(500)
    .required()
    .messages({
      'string.min': 'Refund reason must be at least 10 characters long',
      'string.max': 'Refund reason cannot exceed 500 characters',
      'any.required': 'Refund reason is required'
    }),
  refundMethod: Joi.string()
    .valid('original_payment', 'store_credit', 'bank_transfer')
    .default('original_payment')
    .messages({
      'any.only': 'Refund method must be one of: original_payment, store_credit, bank_transfer'
    })
});

/**
 * Schema for order tracking validation
 * @type {Joi.ObjectSchema}
 */
const trackOrderSchema = Joi.object({
  orderNumber: Joi.string()
    .pattern(/^ORD-\d{4}-\d{6}$/)
    .optional()
    .messages({
      'string.pattern.base': 'Order number must be in format ORD-YYYY-XXXXXX'
    }),
  trackingNumber: Joi.string()
    .min(5)
    .max(50)
    .pattern(/^[A-Z0-9-]+$/)
    .optional()
    .messages({
      'string.min': 'Tracking number must be at least 5 characters long',
      'string.max': 'Tracking number cannot exceed 50 characters',
      'string.pattern.base': 'Tracking number can only contain uppercase letters, numbers, and hyphens'
    })
}).or('orderNumber', 'trackingNumber').messages({
  'object.missing': 'Either order number or tracking number must be provided'
});

module.exports = {
  createOrderSchema,
  updateOrderStatusSchema,
  orderQuerySchema,
  cancelOrderSchema,
  refundOrderSchema,
  trackOrderSchema
};