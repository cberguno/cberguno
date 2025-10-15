# Component Documentation

## Table of Contents

1. [Overview](#overview)
2. [React Components](#react-components)
3. [TypeScript Types](#typescript-types)
4. [Utility Functions](#utility-functions)
5. [Usage Examples](#usage-examples)
6. [Best Practices](#best-practices)

## Overview

This document provides comprehensive documentation for all React components, TypeScript types, and utility functions in the application. Each component includes detailed prop descriptions, usage examples, and implementation notes.

## React Components

### UserProfile

A comprehensive user profile component for displaying and editing user information.

#### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `user` | `User` | ✅ | - | User data to display and edit |
| `onUpdate` | `(updatedUser: UpdateUserRequest) => Promise<void>` | ✅ | - | Callback function called when user data is updated |
| `loading` | `boolean` | ❌ | `false` | Whether the component is in loading state |
| `className` | `string` | ❌ | `''` | Custom CSS class name |
| `editable` | `boolean` | ❌ | `true` | Whether the profile is editable |

#### Features

- **Form Validation**: Client-side validation with real-time error feedback
- **Loading States**: Disabled inputs and loading indicators during updates
- **Accessibility**: Proper ARIA labels and keyboard navigation
- **Error Handling**: Comprehensive error display and recovery

#### Usage Example

```tsx
import React from 'react';
import UserProfile from './components/UserProfile';
import { User, UpdateUserRequest } from './types/user';

const ProfilePage: React.FC = () => {
  const [user, setUser] = useState<User>({
    id: '1',
    email: 'user@example.com',
    firstName: 'John',
    lastName: 'Doe',
    role: 'user',
    isActive: true,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const handleUpdate = async (updatedUser: UpdateUserRequest) => {
    try {
      const response = await fetch('/api/users/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updatedUser)
      });
      
      if (response.ok) {
        const updatedUserData = await response.json();
        setUser(updatedUserData.data);
      }
    } catch (error) {
      console.error('Failed to update profile:', error);
    }
  };

  return (
    <div className="profile-page">
      <h1>My Profile</h1>
      <UserProfile
        user={user}
        onUpdate={handleUpdate}
        editable={true}
        className="profile-section"
      />
    </div>
  );
};
```

#### Styling

The component uses CSS classes for styling:

```css
.user-profile {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.user-profile__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.user-profile__form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
}

.form-label {
  font-weight: 600;
  margin-bottom: 4px;
}

.form-input {
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

.form-input--error {
  border-color: #e74c3c;
}

.form-error {
  color: #e74c3c;
  font-size: 12px;
  margin-top: 4px;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn--primary {
  background-color: #007bff;
  color: white;
}

.btn--secondary {
  background-color: #6c757d;
  color: white;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

### ProductCard

A flexible product card component for displaying product information in various contexts.

#### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `product` | `Product` | ✅ | - | Product data to display |
| `onAddToCart` | `(productId: string, quantity: number) => void` | ❌ | - | Callback function called when add to cart button is clicked |
| `onProductClick` | `(productId: string) => void` | ❌ | - | Callback function called when product is clicked |
| `loading` | `boolean` | ❌ | `false` | Whether the product is in loading state |
| `className` | `string` | ❌ | `''` | Custom CSS class name |
| `showAddToCart` | `boolean` | ❌ | `true` | Whether to show add to cart button |
| `showDetails` | `boolean` | ❌ | `true` | Whether to show product details |
| `maxQuantity` | `number` | ❌ | `10` | Maximum quantity that can be added to cart |

#### Features

- **Responsive Design**: Adapts to different screen sizes
- **Image Handling**: Fallback for missing product images
- **Stock Management**: Visual indicators for stock status
- **Quantity Controls**: Increment/decrement quantity with validation
- **Accessibility**: Keyboard navigation and screen reader support
- **Loading States**: Disabled states during operations

#### Usage Example

```tsx
import React from 'react';
import ProductCard from './components/ProductCard';
import { Product } from './types/product';

const ProductGrid: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  const handleAddToCart = async (productId: string, quantity: number) => {
    setLoading(true);
    try {
      await addToCart(productId, quantity);
      // Show success message
    } catch (error) {
      // Show error message
    } finally {
      setLoading(false);
    }
  };

  const handleProductClick = (productId: string) => {
    navigate(`/products/${productId}`);
  };

  return (
    <div className="product-grid">
      {products.map(product => (
        <ProductCard
          key={product.id}
          product={product}
          onAddToCart={handleAddToCart}
          onProductClick={handleProductClick}
          loading={loading}
          showAddToCart={true}
          showDetails={true}
          maxQuantity={5}
        />
      ))}
    </div>
  );
};
```

#### Styling

```css
.product-card {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  transition: box-shadow 0.2s ease;
  cursor: pointer;
}

.product-card:hover {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.product-card--loading {
  opacity: 0.6;
  pointer-events: none;
}

.product-card__image-container {
  position: relative;
  height: 200px;
  overflow: hidden;
}

.product-card__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.product-card__image-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background-color: #f8f9fa;
  color: #6c757d;
}

.product-card__stock {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.product-card__stock--available {
  background-color: #d4edda;
  color: #155724;
}

.product-card__stock--low {
  background-color: #fff3cd;
  color: #856404;
}

.product-card__stock--out {
  background-color: #f8d7da;
  color: #721c24;
}

.product-card__featured {
  position: absolute;
  top: 8px;
  left: 8px;
  background-color: #007bff;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.product-card__content {
  padding: 16px;
}

.product-card__name {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 8px 0;
  line-height: 1.3;
}

.product-card__description {
  color: #6c757d;
  font-size: 14px;
  line-height: 1.4;
  margin: 0 0 12px 0;
}

.product-card__meta {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.product-card__brand,
.product-card__category {
  font-size: 12px;
  color: #6c757d;
  background-color: #f8f9fa;
  padding: 2px 6px;
  border-radius: 4px;
}

.product-card__rating {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.product-card__stars {
  display: flex;
  gap: 2px;
}

.product-card__star {
  color: #ffc107;
  font-size: 16px;
}

.product-card__star--filled {
  color: #ffc107;
}

.product-card__rating-text {
  font-size: 12px;
  color: #6c757d;
}

.product-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
}

.product-card__tag {
  font-size: 11px;
  background-color: #e9ecef;
  color: #495057;
  padding: 2px 6px;
  border-radius: 12px;
}

.product-card__tag-more {
  font-size: 11px;
  color: #6c757d;
  font-style: italic;
}

.product-card__price {
  margin-bottom: 16px;
}

.product-card__price-current {
  font-size: 20px;
  font-weight: 700;
  color: #28a745;
}

.product-card__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.product-card__quantity {
  display: flex;
  align-items: center;
  border: 1px solid #ced4da;
  border-radius: 4px;
}

.product-card__quantity-btn {
  width: 32px;
  height: 32px;
  border: none;
  background-color: #f8f9fa;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.product-card__quantity-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.product-card__quantity-input {
  width: 50px;
  height: 32px;
  border: none;
  text-align: center;
  font-size: 14px;
}

.product-card__add-btn {
  flex: 1;
  height: 32px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.product-card__add-btn:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

.product-card__out-of-stock {
  text-align: center;
}

.product-card__notify-btn {
  width: 100%;
  height: 32px;
  background-color: #6c757d;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

## TypeScript Types

### User Types

#### User Interface
```typescript
interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  role: UserRole;
  isActive: boolean;
  emailVerified: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

#### UserRole Enumeration
```typescript
enum UserRole {
  USER = 'user',
  ADMIN = 'admin'
}
```

#### UpdateUserRequest Interface
```typescript
interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  email?: string;
}
```

#### ChangePasswordRequest Interface
```typescript
interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}
```

### Product Types

#### Product Interface
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
  dimensions?: ProductDimensions;
  rating?: ProductRating;
  featured: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

#### ProductDimensions Interface
```typescript
interface ProductDimensions {
  length?: number;
  width?: number;
  height?: number;
}
```

#### ProductRating Interface
```typescript
interface ProductRating {
  average: number;
  count: number;
}
```

#### CreateProductRequest Interface
```typescript
interface CreateProductRequest {
  name: string;
  description: string;
  price: number;
  category: string;
  brand: string;
  stock: number;
  images?: string[];
  tags?: string[];
  sku?: string;
  weight?: number;
  dimensions?: ProductDimensions;
  featured?: boolean;
}
```

### Order Types

#### Order Interface
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
  status: OrderStatus;
  shippingAddress: ShippingAddress;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  trackingNumber?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

#### OrderItem Interface
```typescript
interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  total: number;
}
```

#### ShippingAddress Interface
```typescript
interface ShippingAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}
```

#### Order Status Enumeration
```typescript
enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled'
}
```

#### Payment Method Enumeration
```typescript
enum PaymentMethod {
  CREDIT_CARD = 'credit_card',
  DEBIT_CARD = 'debit_card',
  PAYPAL = 'paypal',
  BANK_TRANSFER = 'bank_transfer',
  CASH_ON_DELIVERY = 'cash_on_delivery'
}
```

#### Payment Status Enumeration
```typescript
enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded'
}
```

## Utility Functions

### API Client

#### ApiClient Class
```typescript
class ApiClient {
  constructor(config: ApiConfig);
  
  async request<T>(method: HttpMethod, endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  async get<T>(endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  async post<T>(endpoint: string, data?: any, options?: RequestOptions): Promise<ApiResponse<T>>;
  async put<T>(endpoint: string, data?: any, options?: RequestOptions): Promise<ApiResponse<T>>;
  async patch<T>(endpoint: string, data?: any, options?: RequestOptions): Promise<ApiResponse<T>>;
  async delete<T>(endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  
  setAuthToken(token: string): void;
  getAuthToken(): string | null;
  removeAuthToken(): void;
  updateBaseUrl(baseUrl: string): void;
  updateHeaders(headers: Record<string, string>): void;
}
```

#### Usage Example
```typescript
import { ApiClient, HttpMethod } from './utils/api';

const api = new ApiClient({
  baseUrl: 'http://localhost:3000/api',
  timeout: 10000
});

// Set authentication token
api.setAuthToken('your-jwt-token');

// Make requests
const users = await api.get('/users');
const newUser = await api.post('/users', {
  name: 'John Doe',
  email: 'john@example.com'
});
```

#### Helper Functions
```typescript
// Handle API errors
function handleApiError(error: any): string;

// Check if response is successful
function isSuccessResponse(response: ApiResponse): boolean;

// Extract data from response
function extractData<T>(response: ApiResponse<T>): T | null;

// Extract error from response
function extractError(response: ApiResponse): string | null;
```

## Usage Examples

### Complete User Management Flow

```tsx
import React, { useState, useEffect } from 'react';
import UserProfile from './components/UserProfile';
import { User, UpdateUserRequest } from './types/user';
import { api } from './utils/api';

const UserManagement: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      setLoading(true);
      const response = await api.get('/users/profile');
      
      if (response.success) {
        setUser(response.data);
      } else {
        setError(response.error || 'Failed to load profile');
      }
    } catch (err) {
      setError('An error occurred while loading the profile');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (updatedUser: UpdateUserRequest) => {
    try {
      setLoading(true);
      const response = await api.put('/users/profile', updatedUser);
      
      if (response.success) {
        setUser(response.data);
        setError(null);
      } else {
        setError(response.error || 'Failed to update profile');
      }
    } catch (err) {
      setError('An error occurred while updating the profile');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !user) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (!user) {
    return <div>No user data available</div>;
  }

  return (
    <div className="user-management">
      <h1>User Management</h1>
      <UserProfile
        user={user}
        onUpdate={handleUpdateProfile}
        loading={loading}
        editable={true}
      />
    </div>
  );
};
```

### Product Catalog with Search and Filtering

```tsx
import React, { useState, useEffect } from 'react';
import ProductCard from './components/ProductCard';
import { Product, ProductQueryParams } from './types/product';
import { api } from './utils/api';

const ProductCatalog: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<ProductQueryParams>({
    page: 1,
    limit: 12,
    search: '',
    category: '',
    brand: '',
    minPrice: undefined,
    maxPrice: undefined,
    inStock: true,
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });

  useEffect(() => {
    loadProducts();
  }, [filters]);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const response = await api.get('/products', { params: filters });
      
      if (response.success) {
        setProducts(response.data);
      }
    } catch (error) {
      console.error('Failed to load products:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = async (productId: string, quantity: number) => {
    try {
      await api.post('/cart/add', { productId, quantity });
      // Show success message
    } catch (error) {
      // Show error message
    }
  };

  const handleProductClick = (productId: string) => {
    window.location.href = `/products/${productId}`;
  };

  const handleFilterChange = (newFilters: Partial<ProductQueryParams>) => {
    setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
  };

  return (
    <div className="product-catalog">
      <div className="filters">
        <input
          type="text"
          placeholder="Search products..."
          value={filters.search}
          onChange={(e) => handleFilterChange({ search: e.target.value })}
        />
        <select
          value={filters.category}
          onChange={(e) => handleFilterChange({ category: e.target.value })}
        >
          <option value="">All Categories</option>
          <option value="Electronics">Electronics</option>
          <option value="Clothing">Clothing</option>
        </select>
        <select
          value={filters.sortBy}
          onChange={(e) => handleFilterChange({ sortBy: e.target.value as any })}
        >
          <option value="createdAt">Newest First</option>
          <option value="price">Price</option>
          <option value="name">Name</option>
        </select>
      </div>
      
      <div className="product-grid">
        {products.map(product => (
          <ProductCard
            key={product.id}
            product={product}
            onAddToCart={handleAddToCart}
            onProductClick={handleProductClick}
            loading={loading}
          />
        ))}
      </div>
    </div>
  );
};
```

## Best Practices

### Component Design

1. **Single Responsibility**: Each component should have a single, well-defined purpose
2. **Props Interface**: Always define TypeScript interfaces for component props
3. **Default Props**: Use default parameters for optional props
4. **Error Boundaries**: Implement error boundaries for robust error handling
5. **Loading States**: Always provide loading states for async operations

### Type Safety

1. **Strict Types**: Use strict TypeScript configuration
2. **Interface Segregation**: Create focused interfaces rather than large ones
3. **Generic Types**: Use generics for reusable components and functions
4. **Enum Usage**: Use enums for fixed sets of values
5. **Type Guards**: Implement type guards for runtime type checking

### Performance

1. **Memoization**: Use React.memo for expensive components
2. **Callback Optimization**: Use useCallback for event handlers
3. **Effect Dependencies**: Carefully manage useEffect dependencies
4. **Lazy Loading**: Implement lazy loading for large components
5. **Bundle Splitting**: Use code splitting for better performance

### Accessibility

1. **ARIA Labels**: Provide proper ARIA labels and descriptions
2. **Keyboard Navigation**: Ensure all interactive elements are keyboard accessible
3. **Screen Readers**: Test with screen readers
4. **Color Contrast**: Maintain proper color contrast ratios
5. **Focus Management**: Manage focus for modal and dynamic content

### Testing

1. **Unit Tests**: Write unit tests for all components
2. **Integration Tests**: Test component interactions
3. **Accessibility Tests**: Include accessibility testing
4. **Visual Regression**: Use visual regression testing
5. **Mock Data**: Use consistent mock data for testing

This comprehensive component documentation provides developers with all the information needed to effectively use and maintain the React components, TypeScript types, and utility functions in the application.