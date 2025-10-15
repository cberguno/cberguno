# Comprehensive API Documentation Project

A complete example project demonstrating comprehensive API documentation best practices with detailed examples, usage instructions, and implementation patterns.

## 📋 Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [Features](#features)
- [API Documentation](#api-documentation)
- [Component Documentation](#component-documentation)
- [Function Documentation](#function-documentation)
- [Getting Started](#getting-started)
- [Usage Examples](#usage-examples)
- [Best Practices](#best-practices)
- [Contributing](#contributing)

## 🚀 Overview

This project serves as a comprehensive example of how to document APIs, functions, and components effectively. It includes:

- **RESTful API** with full CRUD operations
- **React Components** with TypeScript
- **Comprehensive Documentation** for all public interfaces
- **Real-world Examples** and usage patterns
- **Best Practices** for documentation

## 📁 Project Structure

```
/workspace
├── src/
│   ├── components/          # React components
│   │   ├── UserProfile.tsx
│   │   └── ProductCard.tsx
│   ├── routes/             # API route handlers
│   │   ├── auth.js
│   │   ├── users.js
│   │   ├── products.js
│   │   └── orders.js
│   ├── models/             # Data models
│   │   ├── User.js
│   │   ├── Product.js
│   │   └── Order.js
│   ├── middleware/         # Express middleware
│   │   ├── auth.js
│   │   └── validation.js
│   ├── schemas/            # Joi validation schemas
│   │   ├── authSchemas.js
│   │   ├── userSchemas.js
│   │   ├── productSchemas.js
│   │   └── orderSchemas.js
│   ├── types/              # TypeScript type definitions
│   │   ├── user.ts
│   │   └── product.ts
│   ├── utils/              # Utility functions
│   │   └── api.ts
│   └── server.js           # Main server file
├── docs/                   # Documentation files
│   ├── API_DOCUMENTATION.md
│   ├── COMPONENT_DOCUMENTATION.md
│   └── FUNCTION_DOCUMENTATION.md
├── package.json
└── README.md
```

## ✨ Features

### API Features
- **Authentication & Authorization** with JWT tokens
- **User Management** with profile updates and password changes
- **Product Catalog** with search, filtering, and pagination
- **Order Management** with status tracking and inventory updates
- **Comprehensive Validation** using Joi schemas
- **Error Handling** with detailed error responses
- **Rate Limiting** and security middleware

### Documentation Features
- **Swagger/OpenAPI** integration for interactive API docs
- **JSDoc** comments for all functions and classes
- **TypeScript** interfaces for type safety
- **Comprehensive Examples** for all endpoints and components
- **Error Scenarios** with detailed explanations
- **SDK Examples** in multiple languages

### Component Features
- **React Components** with TypeScript
- **Props Validation** with detailed interfaces
- **Accessibility** features and ARIA labels
- **Loading States** and error handling
- **Responsive Design** patterns
- **Reusable Utilities** and helper functions

## 📚 API Documentation

### Authentication Endpoints

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe"
}
```

#### Login User
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

### User Management

#### Get User Profile
```http
GET /api/users/profile
Authorization: Bearer <jwt-token>
```

#### Update User Profile
```http
PUT /api/users/profile
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Smith",
  "email": "john.smith@example.com"
}
```

### Product Management

#### Get All Products
```http
GET /api/products?page=1&limit=10&search=headphones&category=Electronics
```

#### Create Product
```http
POST /api/products
Content-Type: application/json

{
  "name": "Wireless Bluetooth Headphones",
  "description": "High-quality wireless headphones with noise cancellation",
  "price": 199.99,
  "category": "Electronics",
  "brand": "TechBrand",
  "stock": 50,
  "images": ["https://example.com/image1.jpg"],
  "tags": ["wireless", "bluetooth", "headphones"]
}
```

### Order Management

#### Create Order
```http
POST /api/orders
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
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
}
```

## 🧩 Component Documentation

### UserProfile Component

A comprehensive user profile component for displaying and editing user information.

```tsx
import UserProfile from './components/UserProfile';

<UserProfile
  user={user}
  onUpdate={handleUpdate}
  editable={true}
  loading={isLoading}
  className="profile-section"
/>
```

**Props:**
- `user` (User): User data to display and edit
- `onUpdate` (Function): Callback when user data is updated
- `editable` (boolean): Whether the profile is editable
- `loading` (boolean): Loading state
- `className` (string): Custom CSS class

### ProductCard Component

A flexible product card component for displaying product information.

```tsx
import ProductCard from './components/ProductCard';

<ProductCard
  product={product}
  onAddToCart={handleAddToCart}
  onProductClick={handleProductClick}
  showAddToCart={true}
  showDetails={true}
  maxQuantity={5}
/>
```

**Props:**
- `product` (Product): Product data to display
- `onAddToCart` (Function): Callback when add to cart is clicked
- `onProductClick` (Function): Callback when product is clicked
- `showAddToCart` (boolean): Whether to show add to cart button
- `showDetails` (boolean): Whether to show product details
- `maxQuantity` (number): Maximum quantity for cart

## 🔧 Function Documentation

### API Client

```typescript
import { ApiClient } from './utils/api';

const api = new ApiClient({
  baseUrl: 'http://localhost:3000/api',
  timeout: 10000
});

// Set authentication token
api.setAuthToken('your-jwt-token');

// Make requests
const users = await api.get('/users');
const newUser = await api.post('/users', userData);
```

### Validation Functions

```typescript
import { validateEmail, validatePassword } from './utils/validation';

const isValidEmail = validateEmail('user@example.com');
const passwordResult = validatePassword('MyPassword123');
```

### Utility Functions

```typescript
import { formatPrice, generateOrderNumber } from './utils/helpers';

const formattedPrice = formatPrice(199.99); // "$199.99"
const orderNumber = generateOrderNumber(); // "ORD-2023-123456"
```

## 🚀 Getting Started

### Prerequisites

- Node.js 16+ 
- npm or yarn
- MongoDB (for data persistence)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd comprehensive-api-docs
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Access the API documentation**
   ```
   http://localhost:3000/api-docs
   ```

### Environment Variables

```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/api-docs
JWT_SECRET=your-secret-key
```

## 💡 Usage Examples

### Complete User Registration Flow

```typescript
// 1. Register user
const registerResponse = await fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'securePassword123',
    firstName: 'John',
    lastName: 'Doe'
  })
});

const { token, user } = await registerResponse.json();

// 2. Get user profile
const profileResponse = await fetch('/api/users/profile', {
  headers: { 'Authorization': `Bearer ${token}` }
});

const profile = await profileResponse.json();

// 3. Update profile
const updateResponse = await fetch('/api/users/profile', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    firstName: 'John',
    lastName: 'Smith'
  })
});
```

### Product Catalog with Search

```typescript
// Search products with filters
const productsResponse = await fetch('/api/products?' + new URLSearchParams({
  search: 'headphones',
  category: 'Electronics',
  minPrice: '50',
  maxPrice: '500',
  inStock: 'true',
  sortBy: 'price',
  sortOrder: 'asc'
}));

const { data: products, pagination } = await productsResponse.json();
```

### Order Management

```typescript
// Create order
const orderResponse = await fetch('/api/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    items: [
      { productId: 'product-id', quantity: 2 }
    ],
    shippingAddress: {
      street: '123 Main Street',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      country: 'US'
    },
    paymentMethod: 'credit_card'
  })
});

const order = await orderResponse.json();
```

## 📖 Documentation Files

### API Documentation
- **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)** - Complete API reference with all endpoints, request/response examples, and error handling

### Component Documentation  
- **[COMPONENT_DOCUMENTATION.md](./COMPONENT_DOCUMENTATION.md)** - React component documentation with props, usage examples, and styling

### Function Documentation
- **[FUNCTION_DOCUMENTATION.md](./FUNCTION_DOCUMENTATION.md)** - Detailed function documentation with parameters, return values, and examples

## 🎯 Best Practices

### API Documentation
- **Consistent Structure**: All endpoints follow the same documentation pattern
- **Real Examples**: Every endpoint includes working code examples
- **Error Scenarios**: Comprehensive error handling documentation
- **Interactive Docs**: Swagger/OpenAPI integration for testing

### Component Documentation
- **Props Interface**: TypeScript interfaces for all component props
- **Usage Examples**: Real-world usage scenarios
- **Accessibility**: ARIA labels and keyboard navigation
- **Styling**: CSS class documentation and examples

### Function Documentation
- **JSDoc Comments**: Comprehensive function documentation
- **Type Safety**: TypeScript for all function signatures
- **Error Handling**: Detailed error scenarios and handling
- **Examples**: Practical usage examples for all functions

### General Practices
- **Version Control**: All documentation is versioned with code
- **Automated Generation**: Documentation is generated from code comments
- **Regular Updates**: Documentation is updated with code changes
- **User Feedback**: Documentation includes feedback mechanisms

## 🤝 Contributing

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Update documentation** for any code changes
4. **Commit your changes** (`git commit -m 'Add amazing feature'`)
5. **Push to the branch** (`git push origin feature/amazing-feature`)
6. **Open a Pull Request**

### Documentation Guidelines

- **Update docs with code changes**
- **Include examples for new features**
- **Test all code examples**
- **Follow existing documentation patterns**
- **Use clear, concise language**

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Express.js for the web framework
- React for the frontend components
- TypeScript for type safety
- Joi for validation
- Swagger for API documentation
- JSDoc for function documentation

---

**Note**: This is a comprehensive example project demonstrating API documentation best practices. All code examples are functional and can be used as a reference for implementing similar features in your own projects.