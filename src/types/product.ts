/**
 * @fileoverview TypeScript type definitions for product-related entities
 * @author API Documentation Generator
 * @version 1.0.0
 */

/**
 * Product entity interface
 * @interface Product
 */
export interface Product {
  /** Unique product identifier */
  id: string;
  /** Product name */
  name: string;
  /** Product description */
  description: string;
  /** Product price in USD */
  price: number;
  /** Product category */
  category: string;
  /** Product brand */
  brand: string;
  /** Available stock quantity */
  stock: number;
  /** Array of product image URLs */
  images?: string[];
  /** Product tags for filtering */
  tags?: string[];
  /** Whether the product is available for purchase */
  isActive: boolean;
  /** Product SKU */
  sku?: string;
  /** Product weight in pounds */
  weight?: number;
  /** Product dimensions */
  dimensions?: ProductDimensions;
  /** Product rating information */
  rating?: ProductRating;
  /** Whether the product is featured */
  featured: boolean;
  /** Product creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Product dimensions interface
 * @interface ProductDimensions
 */
export interface ProductDimensions {
  /** Length in inches */
  length?: number;
  /** Width in inches */
  width?: number;
  /** Height in inches */
  height?: number;
}

/**
 * Product rating interface
 * @interface ProductRating
 */
export interface ProductRating {
  /** Average rating (0-5) */
  average: number;
  /** Number of reviews */
  count: number;
}

/**
 * Request interface for creating a new product
 * @interface CreateProductRequest
 */
export interface CreateProductRequest {
  /** Product name */
  name: string;
  /** Product description */
  description: string;
  /** Product price in USD */
  price: number;
  /** Product category */
  category: string;
  /** Product brand */
  brand: string;
  /** Available stock quantity */
  stock: number;
  /** Array of product image URLs */
  images?: string[];
  /** Product tags for filtering */
  tags?: string[];
  /** Product SKU */
  sku?: string;
  /** Product weight in pounds */
  weight?: number;
  /** Product dimensions */
  dimensions?: ProductDimensions;
  /** Whether the product is featured */
  featured?: boolean;
}

/**
 * Request interface for updating an existing product
 * @interface UpdateProductRequest
 */
export interface UpdateProductRequest {
  /** Product name */
  name?: string;
  /** Product description */
  description?: string;
  /** Product price in USD */
  price?: number;
  /** Product category */
  category?: string;
  /** Product brand */
  brand?: string;
  /** Available stock quantity */
  stock?: number;
  /** Array of product image URLs */
  images?: string[];
  /** Product tags for filtering */
  tags?: string[];
  /** Product SKU */
  sku?: string;
  /** Product weight in pounds */
  weight?: number;
  /** Product dimensions */
  dimensions?: ProductDimensions;
  /** Whether the product is available for purchase */
  isActive?: boolean;
  /** Whether the product is featured */
  featured?: boolean;
}

/**
 * Product query parameters interface
 * @interface ProductQueryParams
 */
export interface ProductQueryParams {
  /** Page number for pagination */
  page?: number;
  /** Number of items per page */
  limit?: number;
  /** Search term for filtering products */
  search?: string;
  /** Filter by category */
  category?: string;
  /** Filter by brand */
  brand?: string;
  /** Minimum price filter */
  minPrice?: number;
  /** Maximum price filter */
  maxPrice?: number;
  /** Filter products that are in stock */
  inStock?: boolean;
  /** Filter featured products */
  featured?: boolean;
  /** Field to sort by */
  sortBy?: 'name' | 'price' | 'createdAt' | 'updatedAt' | 'rating';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated product list response interface
 * @interface ProductListResponse
 */
export interface ProductListResponse {
  /** Whether the operation was successful */
  success: boolean;
  /** Array of products */
  data: Product[];
  /** Pagination information */
  pagination: PaginationInfo;
}

/**
 * Pagination information interface
 * @interface PaginationInfo
 */
export interface PaginationInfo {
  /** Current page number */
  page: number;
  /** Number of items per page */
  limit: number;
  /** Total number of items */
  total: number;
  /** Total number of pages */
  pages: number;
}

/**
 * Product category interface
 * @interface ProductCategory
 */
export interface ProductCategory {
  /** Category ID */
  id: string;
  /** Category name */
  name: string;
  /** Category description */
  description?: string;
  /** Category slug */
  slug: string;
  /** Parent category ID */
  parentId?: string;
  /** Category image URL */
  imageUrl?: string;
  /** Whether the category is active */
  isActive: boolean;
  /** Category creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Product brand interface
 * @interface ProductBrand
 */
export interface ProductBrand {
  /** Brand ID */
  id: string;
  /** Brand name */
  name: string;
  /** Brand description */
  description?: string;
  /** Brand logo URL */
  logoUrl?: string;
  /** Brand website URL */
  websiteUrl?: string;
  /** Whether the brand is active */
  isActive: boolean;
  /** Brand creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Product review interface
 * @interface ProductReview
 */
export interface ProductReview {
  /** Review ID */
  id: string;
  /** Product ID */
  productId: string;
  /** User ID */
  userId: string;
  /** User name */
  userName: string;
  /** Review rating (1-5) */
  rating: number;
  /** Review title */
  title: string;
  /** Review content */
  content: string;
  /** Whether the review is verified */
  verified: boolean;
  /** Review creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Product statistics interface
 * @interface ProductStatistics
 */
export interface ProductStatistics {
  /** Total number of products */
  totalProducts: number;
  /** Number of active products */
  activeProducts: number;
  /** Number of inactive products */
  inactiveProducts: number;
  /** Number of featured products */
  featuredProducts: number;
  /** Number of out-of-stock products */
  outOfStockProducts: number;
  /** Average product price */
  averagePrice: number;
  /** Total inventory value */
  totalInventoryValue: number;
  /** Products added this month */
  newProductsThisMonth: number;
  /** Products added this year */
  newProductsThisYear: number;
}

/**
 * Product search result interface
 * @interface ProductSearchResult
 */
export interface ProductSearchResult {
  /** Product information */
  product: Product;
  /** Search relevance score */
  score: number;
  /** Highlighted search terms */
  highlights?: string[];
}

/**
 * Product filter options interface
 * @interface ProductFilterOptions
 */
export interface ProductFilterOptions {
  /** Available categories */
  categories: string[];
  /** Available brands */
  brands: string[];
  /** Price range */
  priceRange: {
    min: number;
    max: number;
  };
  /** Available tags */
  tags: string[];
}