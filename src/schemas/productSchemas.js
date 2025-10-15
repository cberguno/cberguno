/**
 * @fileoverview Joi validation schemas for product management endpoints
 * @author API Documentation Generator
 * @version 1.0.0
 */

const Joi = require('joi');

/**
 * Schema for creating a new product validation
 * @type {Joi.ObjectSchema}
 */
const createProductSchema = Joi.object({
  name: Joi.string()
    .min(3)
    .max(100)
    .required()
    .messages({
      'string.min': 'Product name must be at least 3 characters long',
      'string.max': 'Product name cannot exceed 100 characters',
      'any.required': 'Product name is required'
    }),
  description: Joi.string()
    .min(10)
    .max(1000)
    .required()
    .messages({
      'string.min': 'Product description must be at least 10 characters long',
      'string.max': 'Product description cannot exceed 1000 characters',
      'any.required': 'Product description is required'
    }),
  price: Joi.number()
    .positive()
    .max(999999.99)
    .precision(2)
    .required()
    .messages({
      'number.positive': 'Price must be a positive number',
      'number.max': 'Price cannot exceed $999,999.99',
      'number.precision': 'Price can have at most 2 decimal places',
      'any.required': 'Price is required'
    }),
  category: Joi.string()
    .min(2)
    .max(50)
    .required()
    .messages({
      'string.min': 'Category must be at least 2 characters long',
      'string.max': 'Category cannot exceed 50 characters',
      'any.required': 'Category is required'
    }),
  brand: Joi.string()
    .min(2)
    .max(50)
    .required()
    .messages({
      'string.min': 'Brand must be at least 2 characters long',
      'string.max': 'Brand cannot exceed 50 characters',
      'any.required': 'Brand is required'
    }),
  stock: Joi.number()
    .integer()
    .min(0)
    .max(999999)
    .required()
    .messages({
      'number.base': 'Stock must be a number',
      'number.integer': 'Stock must be an integer',
      'number.min': 'Stock cannot be negative',
      'number.max': 'Stock cannot exceed 999,999',
      'any.required': 'Stock is required'
    }),
  images: Joi.array()
    .items(
      Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .pattern(/\.(jpg|jpeg|png|gif|webp)$/i)
    )
    .max(10)
    .optional()
    .messages({
      'array.max': 'Cannot have more than 10 images',
      'string.uri': 'Image URL must be a valid HTTP/HTTPS URL',
      'string.pattern.base': 'Image URL must end with a valid image extension'
    }),
  tags: Joi.array()
    .items(
      Joi.string()
        .min(2)
        .max(30)
        .pattern(/^[a-z0-9\s-]+$/)
    )
    .max(20)
    .optional()
    .messages({
      'array.max': 'Cannot have more than 20 tags',
      'string.min': 'Each tag must be at least 2 characters long',
      'string.max': 'Each tag cannot exceed 30 characters',
      'string.pattern.base': 'Tags can only contain lowercase letters, numbers, spaces, and hyphens'
    }),
  sku: Joi.string()
    .min(3)
    .max(50)
    .pattern(/^[A-Z0-9-]+$/)
    .optional()
    .messages({
      'string.min': 'SKU must be at least 3 characters long',
      'string.max': 'SKU cannot exceed 50 characters',
      'string.pattern.base': 'SKU can only contain uppercase letters, numbers, and hyphens'
    }),
  weight: Joi.number()
    .positive()
    .max(999.99)
    .precision(2)
    .optional()
    .messages({
      'number.positive': 'Weight must be a positive number',
      'number.max': 'Weight cannot exceed 999.99',
      'number.precision': 'Weight can have at most 2 decimal places'
    }),
  dimensions: Joi.object({
    length: Joi.number().positive().max(999.99).precision(2).optional(),
    width: Joi.number().positive().max(999.99).precision(2).optional(),
    height: Joi.number().positive().max(999.99).precision(2).optional()
  }).optional().messages({
    'number.positive': 'Dimensions must be positive numbers',
    'number.max': 'Dimensions cannot exceed 999.99',
    'number.precision': 'Dimensions can have at most 2 decimal places'
  }),
  featured: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'Featured must be a boolean value'
    })
});

/**
 * Schema for updating an existing product validation
 * @type {Joi.ObjectSchema}
 */
const updateProductSchema = Joi.object({
  name: Joi.string()
    .min(3)
    .max(100)
    .optional()
    .messages({
      'string.min': 'Product name must be at least 3 characters long',
      'string.max': 'Product name cannot exceed 100 characters'
    }),
  description: Joi.string()
    .min(10)
    .max(1000)
    .optional()
    .messages({
      'string.min': 'Product description must be at least 10 characters long',
      'string.max': 'Product description cannot exceed 1000 characters'
    }),
  price: Joi.number()
    .positive()
    .max(999999.99)
    .precision(2)
    .optional()
    .messages({
      'number.positive': 'Price must be a positive number',
      'number.max': 'Price cannot exceed $999,999.99',
      'number.precision': 'Price can have at most 2 decimal places'
    }),
  category: Joi.string()
    .min(2)
    .max(50)
    .optional()
    .messages({
      'string.min': 'Category must be at least 2 characters long',
      'string.max': 'Category cannot exceed 50 characters'
    }),
  brand: Joi.string()
    .min(2)
    .max(50)
    .optional()
    .messages({
      'string.min': 'Brand must be at least 2 characters long',
      'string.max': 'Brand cannot exceed 50 characters'
    }),
  stock: Joi.number()
    .integer()
    .min(0)
    .max(999999)
    .optional()
    .messages({
      'number.base': 'Stock must be a number',
      'number.integer': 'Stock must be an integer',
      'number.min': 'Stock cannot be negative',
      'number.max': 'Stock cannot exceed 999,999'
    }),
  images: Joi.array()
    .items(
      Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .pattern(/\.(jpg|jpeg|png|gif|webp)$/i)
    )
    .max(10)
    .optional()
    .messages({
      'array.max': 'Cannot have more than 10 images',
      'string.uri': 'Image URL must be a valid HTTP/HTTPS URL',
      'string.pattern.base': 'Image URL must end with a valid image extension'
    }),
  tags: Joi.array()
    .items(
      Joi.string()
        .min(2)
        .max(30)
        .pattern(/^[a-z0-9\s-]+$/)
    )
    .max(20)
    .optional()
    .messages({
      'array.max': 'Cannot have more than 20 tags',
      'string.min': 'Each tag must be at least 2 characters long',
      'string.max': 'Each tag cannot exceed 30 characters',
      'string.pattern.base': 'Tags can only contain lowercase letters, numbers, spaces, and hyphens'
    }),
  sku: Joi.string()
    .min(3)
    .max(50)
    .pattern(/^[A-Z0-9-]+$/)
    .optional()
    .messages({
      'string.min': 'SKU must be at least 3 characters long',
      'string.max': 'SKU cannot exceed 50 characters',
      'string.pattern.base': 'SKU can only contain uppercase letters, numbers, and hyphens'
    }),
  weight: Joi.number()
    .positive()
    .max(999.99)
    .precision(2)
    .optional()
    .messages({
      'number.positive': 'Weight must be a positive number',
      'number.max': 'Weight cannot exceed 999.99',
      'number.precision': 'Weight can have at most 2 decimal places'
    }),
  dimensions: Joi.object({
    length: Joi.number().positive().max(999.99).precision(2).optional(),
    width: Joi.number().positive().max(999.99).precision(2).optional(),
    height: Joi.number().positive().max(999.99).precision(2).optional()
  }).optional().messages({
    'number.positive': 'Dimensions must be positive numbers',
    'number.max': 'Dimensions cannot exceed 999.99',
    'number.precision': 'Dimensions can have at most 2 decimal places'
  }),
  isActive: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'isActive must be a boolean value'
    }),
  featured: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'Featured must be a boolean value'
    })
}).min(1).messages({
  'object.min': 'At least one field must be provided for update'
});

/**
 * Schema for product query parameters validation
 * @type {Joi.ObjectSchema}
 */
const productQuerySchema = Joi.object({
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
  category: Joi.string()
    .min(2)
    .max(50)
    .optional()
    .messages({
      'string.min': 'Category must be at least 2 characters long',
      'string.max': 'Category cannot exceed 50 characters'
    }),
  brand: Joi.string()
    .min(2)
    .max(50)
    .optional()
    .messages({
      'string.min': 'Brand must be at least 2 characters long',
      'string.max': 'Brand cannot exceed 50 characters'
    }),
  minPrice: Joi.number()
    .positive()
    .max(999999.99)
    .precision(2)
    .optional()
    .messages({
      'number.positive': 'Minimum price must be a positive number',
      'number.max': 'Minimum price cannot exceed $999,999.99',
      'number.precision': 'Minimum price can have at most 2 decimal places'
    }),
  maxPrice: Joi.number()
    .positive()
    .max(999999.99)
    .precision(2)
    .optional()
    .messages({
      'number.positive': 'Maximum price must be a positive number',
      'number.max': 'Maximum price cannot exceed $999,999.99',
      'number.precision': 'Maximum price can have at most 2 decimal places'
    }),
  inStock: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'inStock must be a boolean value'
    }),
  featured: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'featured must be a boolean value'
    }),
  sortBy: Joi.string()
    .valid('name', 'price', 'createdAt', 'updatedAt', 'rating')
    .default('createdAt')
    .messages({
      'any.only': 'Sort field must be one of: name, price, createdAt, updatedAt, rating'
    }),
  sortOrder: Joi.string()
    .valid('asc', 'desc')
    .default('desc')
    .messages({
      'any.only': 'Sort order must be either "asc" or "desc"'
    })
});

/**
 * Schema for bulk product operations validation
 * @type {Joi.ObjectSchema}
 */
const bulkProductOperationSchema = Joi.object({
  productIds: Joi.array()
    .items(Joi.string().pattern(/^[0-9a-fA-F]{24}$/))
    .min(1)
    .max(100)
    .required()
    .messages({
      'array.min': 'At least one product ID must be provided',
      'array.max': 'Cannot process more than 100 products at once',
      'any.required': 'Product IDs are required'
    }),
  operation: Joi.string()
    .valid('activate', 'deactivate', 'delete', 'updateCategory', 'updateBrand')
    .required()
    .messages({
      'any.only': 'Operation must be one of: activate, deactivate, delete, updateCategory, updateBrand',
      'any.required': 'Operation is required'
    }),
  updateData: Joi.object({
    category: Joi.string().min(2).max(50).optional(),
    brand: Joi.string().min(2).max(50).optional()
  }).optional().messages({
    'object.base': 'Update data must be an object'
  })
});

module.exports = {
  createProductSchema,
  updateProductSchema,
  productQuerySchema,
  bulkProductOperationSchema
};