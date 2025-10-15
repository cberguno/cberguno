# Comprehensive API Documentation

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [API Endpoints](#api-endpoints)
4. [Data Models](#data-models)
5. [Error Handling](#error-handling)
6. [Rate Limiting](#rate-limiting)
7. [SDK Examples](#sdk-examples)
8. [Testing](#testing)

## Overview

This comprehensive API documentation covers all public APIs, functions, and components in the system. The API follows RESTful principles and provides endpoints for user management, product catalog, order processing, and authentication.

### Base URL
```
http://localhost:3000/api
```

### API Version
```
v1.0.0
```

### Content Type
```
application/json
```

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### Authentication Endpoints

#### Register User
```http
POST /api/auth/register
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "createdAt": "2023-10-15T10:30:00.000Z"
  }
}
```

#### Login User
```http
POST /api/auth/login
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "createdAt": "2023-10-15T10:30:00.000Z"
  }
}
```

#### Refresh Token
```http
POST /api/auth/refresh
```

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Response:**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

## API Endpoints

### User Management

#### Get User Profile
```http
GET /api/users/profile
```

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "user",
    "isActive": true,
    "emailVerified": true,
    "createdAt": "2023-10-15T10:30:00.000Z",
    "updatedAt": "2023-10-15T10:30:00.000Z"
  }
}
```

#### Update User Profile
```http
PUT /api/users/profile
```

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "email": "john.smith@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "email": "john.smith@example.com",
    "firstName": "John",
    "lastName": "Smith",
    "role": "user",
    "isActive": true,
    "emailVerified": true,
    "createdAt": "2023-10-15T10:30:00.000Z",
    "updatedAt": "2023-10-15T11:00:00.000Z"
  }
}
```

#### Change Password
```http
POST /api/users/change-password
```

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Request Body:**
```json
{
  "currentPassword": "oldPassword123",
  "newPassword": "newSecurePassword456",
  "confirmPassword": "newSecurePassword456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

#### Get All Users (Admin Only)
```http
GET /api/users?page=1&limit=10&search=john&role=user&isActive=true
```

**Headers:**
```
Authorization: Bearer <your-admin-jwt-token>
```

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)
- `search` (optional): Search term for name or email
- `role` (optional): Filter by role (user, admin)
- `isActive` (optional): Filter by active status
- `sortBy` (optional): Sort field (firstName, lastName, email, createdAt, updatedAt)
- `sortOrder` (optional): Sort order (asc, desc)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "507f1f77bcf86cd799439011",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "user",
      "isActive": true,
      "createdAt": "2023-10-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "pages": 3
  }
}
```

### Product Management

#### Get All Products
```http
GET /api/products?page=1&limit=10&search=headphones&category=Electronics&brand=TechBrand&minPrice=50&maxPrice=500&inStock=true&sortBy=price&sortOrder=asc
```

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)
- `search` (optional): Search term for name or description
- `category` (optional): Filter by category
- `brand` (optional): Filter by brand
- `minPrice` (optional): Minimum price filter
- `maxPrice` (optional): Maximum price filter
- `inStock` (optional): Filter products in stock
- `featured` (optional): Filter featured products
- `sortBy` (optional): Sort field (name, price, createdAt, updatedAt, rating)
- `sortOrder` (optional): Sort order (asc, desc)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "507f1f77bcf86cd799439011",
      "name": "Wireless Bluetooth Headphones",
      "description": "High-quality wireless headphones with noise cancellation",
      "price": 199.99,
      "category": "Electronics",
      "brand": "TechBrand",
      "stock": 50,
      "images": ["https://example.com/image1.jpg"],
      "tags": ["wireless", "bluetooth", "headphones"],
      "isActive": true,
      "featured": true,
      "createdAt": "2023-10-15T10:30:00.000Z",
      "updatedAt": "2023-10-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "pages": 3
  }
}
```

#### Get Product by ID
```http
GET /api/products/{id}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Wireless Bluetooth Headphones",
    "description": "High-quality wireless headphones with noise cancellation",
    "price": 199.99,
    "category": "Electronics",
    "brand": "TechBrand",
    "stock": 50,
    "images": ["https://example.com/image1.jpg"],
    "tags": ["wireless", "bluetooth", "headphones"],
    "isActive": true,
    "featured": true,
    "createdAt": "2023-10-15T10:30:00.000Z",
    "updatedAt": "2023-10-15T10:30:00.000Z"
  }
}
```

#### Create Product
```http
POST /api/products
```

**Request Body:**
```json
{
  "name": "Wireless Bluetooth Headphones",
  "description": "High-quality wireless headphones with noise cancellation and 30-hour battery life",
  "price": 199.99,
  "category": "Electronics",
  "brand": "TechBrand",
  "stock": 50,
  "images": ["https://example.com/headphones1.jpg", "https://example.com/headphones2.jpg"],
  "tags": ["wireless", "bluetooth", "headphones", "audio", "noise-cancellation"],
  "featured": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Product created successfully",
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Wireless Bluetooth Headphones",
    "description": "High-quality wireless headphones with noise cancellation and 30-hour battery life",
    "price": 199.99,
    "category": "Electronics",
    "brand": "TechBrand",
    "stock": 50,
    "images": ["https://example.com/headphones1.jpg", "https://example.com/headphones2.jpg"],
    "tags": ["wireless", "bluetooth", "headphones", "audio", "noise-cancellation"],
    "isActive": true,
    "featured": true,
    "createdAt": "2023-10-15T10:30:00.000Z",
    "updatedAt": "2023-10-15T10:30:00.000Z"
  }
}
```

#### Update Product
```http
PUT /api/products/{id}
```

**Request Body:**
```json
{
  "price": 179.99,
  "stock": 75,
  "description": "Updated description with new features"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Product updated successfully",
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Wireless Bluetooth Headphones",
    "description": "Updated description with new features",
    "price": 179.99,
    "category": "Electronics",
    "brand": "TechBrand",
    "stock": 75,
    "images": ["https://example.com/headphones1.jpg"],
    "tags": ["wireless", "bluetooth", "headphones"],
    "isActive": true,
    "featured": true,
    "createdAt": "2023-10-15T10:30:00.000Z",
    "updatedAt": "2023-10-15T11:00:00.000Z"
  }
}
```

#### Delete Product
```http
DELETE /api/products/{id}
```

**Response:**
```json
{
  "success": true,
  "message": "Product deleted successfully"
}
```

### Order Management

#### Get User Orders
```http
GET /api/orders?page=1&limit=10&status=pending&sortBy=createdAt&sortOrder=desc
```

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)
- `status` (optional): Filter by status (pending, confirmed, processing, shipped, delivered, cancelled)
- `paymentStatus` (optional): Filter by payment status (pending, paid, failed, refunded)
- `startDate` (optional): Filter orders from date (ISO format)
- `endDate` (optional): Filter orders to date (ISO format)
- `minTotal` (optional): Minimum order total
- `maxTotal` (optional): Maximum order total
- `sortBy` (optional): Sort field (createdAt, updatedAt, total, status, orderNumber)
- `sortOrder` (optional): Sort order (asc, desc)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "507f1f77bcf86cd799439011",
      "userId": "507f1f77bcf86cd799439012",
      "orderNumber": "ORD-2023-001234",
      "items": [
        {
          "productId": "507f1f77bcf86cd799439013",
          "productName": "Wireless Bluetooth Headphones",
          "quantity": 2,
          "price": 199.99,
          "total": 399.98
        }
      ],
      "subtotal": 399.98,
      "tax": 32.00,
      "shipping": 9.99,
      "total": 441.97,
      "status": "pending",
      "shippingAddress": {
        "street": "123 Main Street",
        "city": "New York",
        "state": "NY",
        "zipCode": "10001",
        "country": "US"
      },
      "paymentMethod": "credit_card",
      "paymentStatus": "pending",
      "createdAt": "2023-10-15T10:30:00.000Z",
      "updatedAt": "2023-10-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 5,
    "pages": 1
  }
}
```

#### Get Order by ID
```http
GET /api/orders/{id}
```

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "userId": "507f1f77bcf86cd799439012",
    "orderNumber": "ORD-2023-001234",
    "items": [
      {
        "productId": "507f1f77bcf86cd799439013",
        "productName": "Wireless Bluetooth Headphones",
        "quantity": 2,
        "price": 199.99,
        "total": 399.98
      }
    ],
    "subtotal": 399.98,
    "tax": 32.00,
    "shipping": 9.99,
    "total": 441.97,
    "status": "pending",
    "shippingAddress": {
      "street": "123 Main Street",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001",
      "country": "US"
    },
    "paymentMethod": "credit_card",
    "paymentStatus": "pending",
    "createdAt": "2023-10-15T10:30:00.000Z",
    "updatedAt": "2023-10-15T10:30:00.000Z"
  }
}
```

#### Create Order
```http
POST /api/orders
```

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Request Body:**
```json
{
  "items": [
    {
      "productId": "507f1f77bcf86cd799439013",
      "quantity": 2
    },
    {
      "productId": "507f1f77bcf86cd799439014",
      "quantity": 1
    }
  ],
  "shippingAddress": {
    "street": "123 Main Street",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "country": "US"
  },
  "paymentMethod": "credit_card",
  "notes": "Please leave package at front door"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Order created successfully",
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "userId": "507f1f77bcf86cd799439012",
    "orderNumber": "ORD-2023-001234",
    "items": [
      {
        "productId": "507f1f77bcf86cd799439013",
        "productName": "Wireless Bluetooth Headphones",
        "quantity": 2,
        "price": 199.99,
        "total": 399.98
      }
    ],
    "subtotal": 399.98,
    "tax": 32.00,
    "shipping": 9.99,
    "total": 441.97,
    "status": "pending",
    "shippingAddress": {
      "street": "123 Main Street",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001",
      "country": "US"
    },
    "paymentMethod": "credit_card",
    "paymentStatus": "pending",
    "notes": "Please leave package at front door",
    "createdAt": "2023-10-15T10:30:00.000Z",
    "updatedAt": "2023-10-15T10:30:00.000Z"
  }
}
```

#### Update Order Status (Admin Only)
```http
PUT /api/orders/{id}/status
```

**Headers:**
```
Authorization: Bearer <your-admin-jwt-token>
```

**Request Body:**
```json
{
  "status": "shipped",
  "trackingNumber": "1Z999AA1234567890",
  "notes": "Package shipped via UPS"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Order status updated successfully",
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "userId": "507f1f77bcf86cd799439012",
    "orderNumber": "ORD-2023-001234",
    "status": "shipped",
    "trackingNumber": "1Z999AA1234567890",
    "notes": "Package shipped via UPS",
    "updatedAt": "2023-10-15T11:00:00.000Z"
  }
}
```

### System Endpoints

#### Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2023-10-15T10:30:00.000Z",
  "uptime": 123.456
}
```

## Data Models

### User Model
```typescript
interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  role: 'user' | 'admin';
  isActive: boolean;
  emailVerified: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### Product Model
```typescript
interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  brand: string;
  stock: number;
  images?: string[];
  tags?: string[];
  isActive: boolean;
  sku?: string;
  weight?: number;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
  };
  rating?: {
    average: number;
    count: number;
  };
  featured: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Order Model
```typescript
interface Order {
  id: string;
  userId: string;
  orderNumber: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  shippingAddress: ShippingAddress;
  paymentMethod: 'credit_card' | 'debit_card' | 'paypal' | 'bank_transfer' | 'cash_on_delivery';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  trackingNumber?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  total: number;
}

interface ShippingAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}
```

## Error Handling

The API uses standard HTTP status codes and returns consistent error responses:

### Error Response Format
```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional error details",
  "validationErrors": [
    {
      "field": "email",
      "message": "Please provide a valid email address",
      "value": "invalid-email"
    }
  ]
}
```

### HTTP Status Codes
- `200` - OK: Request successful
- `201` - Created: Resource created successfully
- `400` - Bad Request: Invalid request data
- `401` - Unauthorized: Authentication required
- `403` - Forbidden: Access denied
- `404` - Not Found: Resource not found
- `409` - Conflict: Resource already exists
- `422` - Unprocessable Entity: Validation failed
- `500` - Internal Server Error: Server error

### Common Error Scenarios

#### Validation Error
```json
{
  "success": false,
  "error": "Validation failed",
  "details": "The request data is invalid",
  "validationErrors": [
    {
      "field": "password",
      "message": "Password must be at least 6 characters long",
      "value": "123"
    }
  ]
}
```

#### Authentication Error
```json
{
  "success": false,
  "error": "Invalid credentials",
  "details": "The provided email or password is incorrect"
}
```

#### Authorization Error
```json
{
  "success": false,
  "error": "Access denied",
  "details": "You can only access your own resources"
}
```

#### Not Found Error
```json
{
  "success": false,
  "error": "Product not found",
  "details": "The requested product could not be found"
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse:

- **General endpoints**: 100 requests per minute per IP
- **Authentication endpoints**: 10 requests per minute per IP
- **User-specific endpoints**: 1000 requests per minute per user

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

When rate limit is exceeded:
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "details": "Too many requests. Please try again later."
}
```

## SDK Examples

### JavaScript/TypeScript

#### Using Fetch API
```javascript
// Register a new user
const registerUser = async (userData) => {
  const response = await fetch('http://localhost:3000/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(userData)
  });
  
  const data = await response.json();
  return data;
};

// Get products with authentication
const getProducts = async (token) => {
  const response = await fetch('http://localhost:3000/api/products', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  });
  
  const data = await response.json();
  return data;
};
```

#### Using Axios
```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api',
  headers: {
    'Content-Type': 'application/json',
  }
});

// Add request interceptor for authentication
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Register user
const registerUser = async (userData) => {
  const response = await api.post('/auth/register', userData);
  return response.data;
};

// Get products
const getProducts = async (params = {}) => {
  const response = await api.get('/products', { params });
  return response.data;
};
```

### Python

#### Using Requests
```python
import requests
import json

class APIClient:
    def __init__(self, base_url='http://localhost:3000/api'):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json'
        })
    
    def set_auth_token(self, token):
        self.session.headers.update({
            'Authorization': f'Bearer {token}'
        })
    
    def register_user(self, user_data):
        response = self.session.post(
            f'{self.base_url}/auth/register',
            json=user_data
        )
        return response.json()
    
    def get_products(self, params=None):
        response = self.session.get(
            f'{self.base_url}/products',
            params=params
        )
        return response.json()

# Usage
client = APIClient()
user_data = {
    'email': 'user@example.com',
    'password': 'securePassword123',
    'firstName': 'John',
    'lastName': 'Doe'
}
result = client.register_user(user_data)
```

### cURL Examples

#### Register User
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securePassword123",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

#### Login User
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securePassword123"
  }'
```

#### Get Products
```bash
curl -X GET "http://localhost:3000/api/products?page=1&limit=10&search=headphones" \
  -H "Content-Type: application/json"
```

#### Create Order
```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "items": [
      {
        "productId": "507f1f77bcf86cd799439011",
        "quantity": 2
      }
    ],
    "shippingAddress": {
      "street": "123 Main Street",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001",
      "country": "US"
    },
    "paymentMethod": "credit_card"
  }'
```

## Testing

### Postman Collection

A Postman collection is available for testing all endpoints:

1. Import the collection from `/docs/postman-collection.json`
2. Set the `base_url` variable to your API URL
3. Use the authentication endpoints to get a token
4. Set the `auth_token` variable for authenticated requests

### Automated Testing

#### Unit Tests
```javascript
// Example Jest test
describe('User API', () => {
  test('should register a new user', async () => {
    const userData = {
      email: 'test@example.com',
      password: 'password123',
      firstName: 'Test',
      lastName: 'User'
    };
    
    const response = await request(app)
      .post('/api/auth/register')
      .send(userData)
      .expect(201);
    
    expect(response.body.success).toBe(true);
    expect(response.body.user.email).toBe(userData.email);
  });
});
```

#### Integration Tests
```javascript
describe('Product API Integration', () => {
  test('should create and retrieve product', async () => {
    // Create product
    const productData = {
      name: 'Test Product',
      description: 'Test Description',
      price: 99.99,
      category: 'Test',
      brand: 'TestBrand',
      stock: 10
    };
    
    const createResponse = await request(app)
      .post('/api/products')
      .send(productData)
      .expect(201);
    
    const productId = createResponse.body.data.id;
    
    // Retrieve product
    const getResponse = await request(app)
      .get(`/api/products/${productId}`)
      .expect(200);
    
    expect(getResponse.body.data.name).toBe(productData.name);
  });
});
```

### Load Testing

Use tools like Artillery or k6 for load testing:

```yaml
# artillery.yml
config:
  target: 'http://localhost:3000'
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - name: "API Load Test"
    flow:
      - get:
          url: "/api/products"
      - post:
          url: "/api/auth/login"
          json:
            email: "test@example.com"
            password: "password123"
```

This comprehensive documentation covers all aspects of the API, including detailed endpoint descriptions, request/response examples, data models, error handling, and testing strategies. The documentation is designed to be both human-readable and machine-parseable for automated tooling.