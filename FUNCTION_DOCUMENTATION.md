# Function Documentation

## Table of Contents

1. [Overview](#overview)
2. [Authentication Functions](#authentication-functions)
3. [User Management Functions](#user-management-functions)
4. [Product Management Functions](#product-management-functions)
5. [Order Management Functions](#order-management-functions)
6. [Utility Functions](#utility-functions)
7. [Validation Functions](#validation-functions)
8. [Error Handling Functions](#error-handling-functions)

## Overview

This document provides comprehensive documentation for all public functions, methods, and utilities in the application. Each function includes detailed parameter descriptions, return values, usage examples, and implementation notes.

## Authentication Functions

### authenticateToken

Middleware function to authenticate JWT tokens for protected routes.

#### Signature
```typescript
const authenticateToken = async (req: Request, res: Response, next: NextFunction): Promise<void>
```

#### Parameters
- `req` (Request): Express request object
- `res` (Response): Express response object  
- `next` (NextFunction): Express next function

#### Returns
- `Promise<void>`: Resolves when authentication is complete

#### Description
Verifies JWT tokens from the Authorization header and adds user information to the request object. Handles various error scenarios including invalid tokens, expired tokens, and missing tokens.

#### Usage Example
```typescript
import { authenticateToken } from './middleware/auth';

// Protect a route
router.get('/protected', authenticateToken, (req, res) => {
  res.json({ message: 'Access granted', user: req.user });
});
```

#### Error Responses
- `401 Unauthorized`: Missing or invalid token
- `401 Unauthorized`: Expired token
- `401 Unauthorized`: User not found or inactive

### requireAdmin

Middleware function to check if user has admin role.

#### Signature
```typescript
const requireAdmin = (req: Request, res: Response, next: NextFunction): void
```

#### Parameters
- `req` (Request): Express request object with user information
- `res` (Response): Express response object
- `next` (NextFunction): Express next function

#### Returns
- `void`: Calls next() if user is admin, otherwise sends error response

#### Description
Checks if the authenticated user has admin role. Must be used after authenticateToken middleware.

#### Usage Example
```typescript
import { authenticateToken, requireAdmin } from './middleware/auth';

// Admin-only route
router.get('/admin/users', authenticateToken, requireAdmin, (req, res) => {
  // Admin-only logic here
});
```

#### Error Responses
- `401 Unauthorized`: User not authenticated
- `403 Forbidden`: User is not an admin

### requireOwnershipOrAdmin

Middleware factory to check if user owns resource or is admin.

#### Signature
```typescript
const requireOwnershipOrAdmin = (userIdParam: string = 'userId') => (req: Request, res: Response, next: NextFunction): void
```

#### Parameters
- `userIdParam` (string): Name of the parameter containing user ID (default: 'userId')

#### Returns
- `Function`: Middleware function that checks ownership or admin status

#### Description
Creates middleware that allows access if the user owns the resource (based on userIdParam) or is an admin.

#### Usage Example
```typescript
import { authenticateToken, requireOwnershipOrAdmin } from './middleware/auth';

// User can access their own profile or admin can access any profile
router.get('/users/:userId/profile', 
  authenticateToken, 
  requireOwnershipOrAdmin('userId'), 
  (req, res) => {
    // Logic here
  }
);
```

#### Error Responses
- `401 Unauthorized`: User not authenticated
- `403 Forbidden`: User doesn't own resource and is not admin

## User Management Functions

### validateRequest

Middleware factory for request validation using Joi schemas.

#### Signature
```typescript
const validateRequest = (schema: Joi.ObjectSchema, property: string = 'body') => (req: Request, res: Response, next: NextFunction): void
```

#### Parameters
- `schema` (Joi.ObjectSchema): Joi validation schema
- `property` (string): Request property to validate ('body', 'query', 'params')

#### Returns
- `Function`: Express middleware function

#### Description
Creates middleware that validates request data against a Joi schema and sanitizes the data.

#### Usage Example
```typescript
import { validateRequest } from './middleware/validation';
import { updateUserSchema } from './schemas/userSchemas';

router.put('/users/profile', 
  validateRequest(updateUserSchema), 
  (req, res) => {
    // req.body is validated and sanitized
  }
);
```

#### Error Responses
- `400 Bad Request`: Validation failed with detailed error messages

### validateObjectId

Middleware to validate MongoDB ObjectId format.

#### Signature
```typescript
const validateObjectId = (paramName: string = 'id') => (req: Request, res: Response, next: NextFunction): void
```

#### Parameters
- `paramName` (string): Name of the parameter containing the ObjectId (default: 'id')

#### Returns
- `Function`: Express middleware function

#### Description
Validates that the specified parameter contains a valid MongoDB ObjectId format.

#### Usage Example
```typescript
import { validateObjectId } from './middleware/validation';

router.get('/users/:id', 
  validateObjectId('id'), 
  (req, res) => {
    // req.params.id is guaranteed to be a valid ObjectId
  }
);
```

#### Error Responses
- `400 Bad Request`: Invalid ObjectId format

### validatePagination

Middleware to validate pagination parameters.

#### Signature
```typescript
const validatePagination = (req: Request, res: Response, next: NextFunction): void
```

#### Parameters
- `req` (Request): Express request object
- `res` (Response): Express response object
- `next` (NextFunction): Express next function

#### Returns
- `void`: Calls next() if validation passes, otherwise sends error response

#### Description
Validates and normalizes pagination parameters (page, limit) and adds them to req.pagination.

#### Usage Example
```typescript
import { validatePagination } from './middleware/validation';

router.get('/users', 
  validatePagination, 
  (req, res) => {
    const { page, limit } = req.pagination;
    // Use pagination parameters
  }
);
```

#### Error Responses
- `400 Bad Request`: Invalid pagination parameters

## Product Management Functions

### createProduct

Creates a new product in the system.

#### Signature
```typescript
const createProduct = async (productData: CreateProductRequest): Promise<Product>
```

#### Parameters
- `productData` (CreateProductRequest): Product data to create

#### Returns
- `Promise<Product>`: Created product object

#### Description
Creates a new product with validation, generates SKU if not provided, and sets default values.

#### Usage Example
```typescript
import { createProduct } from './services/productService';

const productData = {
  name: 'Wireless Headphones',
  description: 'High-quality wireless headphones',
  price: 199.99,
  category: 'Electronics',
  brand: 'TechBrand',
  stock: 50
};

const product = await createProduct(productData);
console.log('Created product:', product.id);
```

#### Throws
- `ValidationError`: If product data is invalid
- `DuplicateError`: If SKU already exists

### updateProduct

Updates an existing product.

#### Signature
```typescript
const updateProduct = async (productId: string, updateData: UpdateProductRequest): Promise<Product>
```

#### Parameters
- `productId` (string): Product ID to update
- `updateData` (UpdateProductRequest): Updated product data

#### Returns
- `Promise<Product>`: Updated product object

#### Description
Updates product with validation and maintains data integrity.

#### Usage Example
```typescript
import { updateProduct } from './services/productService';

const updatedProduct = await updateProduct('507f1f77bcf86cd799439011', {
  price: 179.99,
  stock: 75
});
```

#### Throws
- `NotFoundError`: If product doesn't exist
- `ValidationError`: If update data is invalid

### getProducts

Retrieves products with filtering and pagination.

#### Signature
```typescript
const getProducts = async (queryParams: ProductQueryParams): Promise<ProductListResponse>
```

#### Parameters
- `queryParams` (ProductQueryParams): Query parameters for filtering and pagination

#### Returns
- `Promise<ProductListResponse>`: Paginated list of products

#### Description
Retrieves products with advanced filtering, searching, and pagination capabilities.

#### Usage Example
```typescript
import { getProducts } from './services/productService';

const products = await getProducts({
  page: 1,
  limit: 10,
  search: 'headphones',
  category: 'Electronics',
  minPrice: 50,
  maxPrice: 500,
  inStock: true,
  sortBy: 'price',
  sortOrder: 'asc'
});
```

### deleteProduct

Soft deletes a product by setting isActive to false.

#### Signature
```typescript
const deleteProduct = async (productId: string): Promise<void>
```

#### Parameters
- `productId` (string): Product ID to delete

#### Returns
- `Promise<void>`: Resolves when product is deleted

#### Description
Performs soft delete by setting isActive to false, preserving data integrity.

#### Usage Example
```typescript
import { deleteProduct } from './services/productService';

await deleteProduct('507f1f77bcf86cd799439011');
console.log('Product deleted successfully');
```

#### Throws
- `NotFoundError`: If product doesn't exist

## Order Management Functions

### createOrder

Creates a new order for a user.

#### Signature
```typescript
const createOrder = async (userId: string, orderData: CreateOrderRequest): Promise<Order>
```

#### Parameters
- `userId` (string): User ID placing the order
- `orderData` (CreateOrderRequest): Order data including items and shipping address

#### Returns
- `Promise<Order>`: Created order object

#### Description
Creates order with validation, calculates totals, updates product stock, and generates order number.

#### Usage Example
```typescript
import { createOrder } from './services/orderService';

const orderData = {
  items: [
    { productId: '507f1f77bcf86cd799439011', quantity: 2 },
    { productId: '507f1f77bcf86cd799439012', quantity: 1 }
  ],
  shippingAddress: {
    street: '123 Main Street',
    city: 'New York',
    state: 'NY',
    zipCode: '10001',
    country: 'US'
  },
  paymentMethod: 'credit_card'
};

const order = await createOrder('507f1f77bcf86cd799439012', orderData);
```

#### Throws
- `ValidationError`: If order data is invalid
- `InsufficientStockError`: If product stock is insufficient
- `NotFoundError`: If product doesn't exist

### updateOrderStatus

Updates the status of an existing order.

#### Signature
```typescript
const updateOrderStatus = async (orderId: string, statusData: UpdateOrderStatusRequest): Promise<Order>
```

#### Parameters
- `orderId` (string): Order ID to update
- `statusData` (UpdateOrderStatusRequest): New status and related data

#### Returns
- `Promise<Order>`: Updated order object

#### Description
Updates order status with validation and business logic constraints.

#### Usage Example
```typescript
import { updateOrderStatus } from './services/orderService';

const updatedOrder = await updateOrderStatus('507f1f77bcf86cd799439011', {
  status: 'shipped',
  trackingNumber: '1Z999AA1234567890',
  notes: 'Package shipped via UPS'
});
```

#### Throws
- `NotFoundError`: If order doesn't exist
- `ValidationError`: If status data is invalid

### getOrders

Retrieves orders for a user with filtering and pagination.

#### Signature
```typescript
const getOrders = async (userId: string, queryParams: OrderQueryParams): Promise<OrderListResponse>
```

#### Parameters
- `userId` (string): User ID to get orders for
- `queryParams` (OrderQueryParams): Query parameters for filtering and pagination

#### Returns
- `Promise<OrderListResponse>`: Paginated list of orders

#### Description
Retrieves user orders with advanced filtering and pagination.

#### Usage Example
```typescript
import { getOrders } from './services/orderService';

const orders = await getOrders('507f1f77bcf86cd799439012', {
  page: 1,
  limit: 10,
  status: 'pending',
  sortBy: 'createdAt',
  sortOrder: 'desc'
});
```

## Utility Functions

### formatPrice

Formats a number as currency.

#### Signature
```typescript
const formatPrice = (price: number, currency: string = 'USD', locale: string = 'en-US'): string
```

#### Parameters
- `price` (number): Price value to format
- `currency` (string): Currency code (default: 'USD')
- `locale` (string): Locale string (default: 'en-US')

#### Returns
- `string`: Formatted price string

#### Description
Formats a number as currency using Intl.NumberFormat.

#### Usage Example
```typescript
import { formatPrice } from './utils/formatting';

const formattedPrice = formatPrice(199.99); // "$199.99"
const euroPrice = formatPrice(199.99, 'EUR', 'de-DE'); // "199,99 €"
```

### generateOrderNumber

Generates a unique order number.

#### Signature
```typescript
const generateOrderNumber = (): string
```

#### Parameters
None

#### Returns
- `string`: Generated order number in format "ORD-YYYY-XXXXXX"

#### Description
Generates a unique order number using current year and timestamp.

#### Usage Example
```typescript
import { generateOrderNumber } from './utils/order';

const orderNumber = generateOrderNumber(); // "ORD-2023-123456"
```

### calculateOrderTotals

Calculates order totals including tax and shipping.

#### Signature
```typescript
const calculateOrderTotals = (items: OrderItem[], taxRate: number = 0.08, freeShippingThreshold: number = 100): { subtotal: number; tax: number; shipping: number; total: number }
```

#### Parameters
- `items` (OrderItem[]): Array of order items
- `taxRate` (number): Tax rate as decimal (default: 0.08 for 8%)
- `freeShippingThreshold` (number): Free shipping threshold (default: 100)

#### Returns
- `Object`: Object containing subtotal, tax, shipping, and total

#### Description
Calculates order totals with configurable tax rate and free shipping threshold.

#### Usage Example
```typescript
import { calculateOrderTotals } from './utils/order';

const items = [
  { productId: '1', productName: 'Product 1', quantity: 2, price: 50, total: 100 },
  { productId: '2', productName: 'Product 2', quantity: 1, price: 30, total: 30 }
];

const totals = calculateOrderTotals(items);
// { subtotal: 130, tax: 10.4, shipping: 9.99, total: 150.39 }
```

### validateEmail

Validates email address format.

#### Signature
```typescript
const validateEmail = (email: string): boolean
```

#### Parameters
- `email` (string): Email address to validate

#### Returns
- `boolean`: True if email is valid, false otherwise

#### Description
Validates email address using regex pattern.

#### Usage Example
```typescript
import { validateEmail } from './utils/validation';

const isValid = validateEmail('user@example.com'); // true
const isInvalid = validateEmail('invalid-email'); // false
```

### generateSKU

Generates a product SKU from brand and random string.

#### Signature
```typescript
const generateSKU = (brand: string, length: number = 6): string
```

#### Parameters
- `brand` (string): Brand name to use as prefix
- `length` (number): Length of random suffix (default: 6)

#### Returns
- `string`: Generated SKU in format "BRAND-XXXXXX"

#### Description
Generates a unique SKU using brand prefix and random alphanumeric suffix.

#### Usage Example
```typescript
import { generateSKU } from './utils/product';

const sku = generateSKU('TechBrand'); // "TEC-ABC123"
const customSku = generateSKU('MyBrand', 8); // "MYB-ABCD1234"
```

## Validation Functions

### validatePassword

Validates password strength.

#### Signature
```typescript
const validatePassword = (password: string): { isValid: boolean; errors: string[] }
```

#### Parameters
- `password` (string): Password to validate

#### Returns
- `Object`: Object containing validation result and error messages

#### Description
Validates password against strength requirements including length, character types, and patterns.

#### Usage Example
```typescript
import { validatePassword } from './utils/validation';

const result = validatePassword('MyPassword123');
if (result.isValid) {
  console.log('Password is valid');
} else {
  console.log('Password errors:', result.errors);
}
```

### validatePhoneNumber

Validates phone number format.

#### Signature
```typescript
const validatePhoneNumber = (phoneNumber: string, countryCode: string = 'US'): boolean
```

#### Parameters
- `phoneNumber` (string): Phone number to validate
- `countryCode` (string): Country code for validation (default: 'US')

#### Returns
- `boolean`: True if phone number is valid, false otherwise

#### Description
Validates phone number format based on country code.

#### Usage Example
```typescript
import { validatePhoneNumber } from './utils/validation';

const isValidUS = validatePhoneNumber('(555) 123-4567'); // true
const isValidUK = validatePhoneNumber('+44 20 7946 0958', 'UK'); // true
```

### validateCreditCard

Validates credit card number using Luhn algorithm.

#### Signature
```typescript
const validateCreditCard = (cardNumber: string): { isValid: boolean; type: string | null }
```

#### Parameters
- `cardNumber` (string): Credit card number to validate

#### Returns
- `Object`: Object containing validation result and card type

#### Description
Validates credit card number using Luhn algorithm and identifies card type.

#### Usage Example
```typescript
import { validateCreditCard } from './utils/validation';

const result = validateCreditCard('4111111111111111');
if (result.isValid) {
  console.log('Valid', result.type, 'card'); // "Valid Visa card"
}
```

## Error Handling Functions

### handleApiError

Handles and formats API errors.

#### Signature
```typescript
const handleApiError = (error: any): string
```

#### Parameters
- `error` (any): Error object to handle

#### Returns
- `string`: Formatted error message

#### Description
Handles various types of errors and returns user-friendly error messages.

#### Usage Example
```typescript
import { handleApiError } from './utils/error';

try {
  await api.get('/users');
} catch (error) {
  const errorMessage = handleApiError(error);
  console.error('API Error:', errorMessage);
}
```

### createError

Creates a standardized error object.

#### Signature
```typescript
const createError = (message: string, statusCode: number = 500, code?: string): Error
```

#### Parameters
- `message` (string): Error message
- `statusCode` (number): HTTP status code (default: 500)
- `code` (string): Error code (optional)

#### Returns
- `Error`: Standardized error object

#### Description
Creates a standardized error object with message, status code, and optional error code.

#### Usage Example
```typescript
import { createError } from './utils/error';

const error = createError('User not found', 404, 'USER_NOT_FOUND');
throw error;
```

### logError

Logs error with context information.

#### Signature
```typescript
const logError = (error: Error, context?: Record<string, any>): void
```

#### Parameters
- `error` (Error): Error object to log
- `context` (Record<string, any>): Additional context information (optional)

#### Returns
- `void`: Logs error to console or logging service

#### Description
Logs error with stack trace and optional context information.

#### Usage Example
```typescript
import { logError } from './utils/error';

try {
  await processOrder(orderId);
} catch (error) {
  logError(error, { orderId, userId: req.user.id });
}
```

This comprehensive function documentation provides developers with detailed information about all public functions, their parameters, return values, usage examples, and error handling. Each function is documented with clear examples and best practices for implementation.