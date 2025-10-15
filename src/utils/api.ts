/**
 * @fileoverview API utility functions for making HTTP requests
 * @author API Documentation Generator
 * @version 1.0.0
 */

/**
 * HTTP methods enumeration
 * @enum {string}
 */
export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE'
}

/**
 * API response interface
 * @interface ApiResponse
 * @template T - Response data type
 */
export interface ApiResponse<T = any> {
  /** Whether the request was successful */
  success: boolean;
  /** Response data */
  data?: T;
  /** Error message */
  error?: string;
  /** Additional error details */
  details?: string;
  /** Validation errors */
  validationErrors?: Array<{
    field: string;
    message: string;
    value?: any;
  }>;
  /** Pagination information */
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

/**
 * API configuration interface
 * @interface ApiConfig
 */
export interface ApiConfig {
  /** Base URL for API requests */
  baseUrl: string;
  /** Default timeout in milliseconds */
  timeout?: number;
  /** Default headers */
  headers?: Record<string, string>;
}

/**
 * Request options interface
 * @interface RequestOptions
 */
export interface RequestOptions {
  /** Request headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Whether to include credentials */
  credentials?: RequestCredentials;
  /** Request body */
  body?: any;
}

/**
 * API client class for making HTTP requests
 * @class ApiClient
 */
export class ApiClient {
  private config: ApiConfig;

  /**
   * Create a new API client instance
   * @param config - API configuration
   */
  constructor(config: ApiConfig) {
    this.config = {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      ...config
    };
  }

  /**
   * Make an HTTP request
   * @param method - HTTP method
   * @param endpoint - API endpoint
   * @param options - Request options
   * @returns Promise resolving to API response
   * 
   * @example
   * ```typescript
   * const client = new ApiClient({ baseUrl: 'https://api.example.com' });
   * 
   * // GET request
   * const users = await client.request('GET', '/users');
   * 
   * // POST request with data
   * const newUser = await client.request('POST', '/users', {
   *   body: { name: 'John Doe', email: 'john@example.com' }
   * });
   * ```
   */
  async request<T = any>(
    method: HttpMethod,
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const requestHeaders = {
      ...this.config.headers,
      ...options.headers
    };

    // Add authorization header if token exists
    const token = this.getAuthToken();
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || this.config.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: options.body ? JSON.stringify(options.body) : undefined,
        credentials: options.credentials || 'same-origin',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      
      throw error;
    }
  }

  /**
   * Make a GET request
   * @param endpoint - API endpoint
   * @param options - Request options
   * @returns Promise resolving to API response
   */
  async get<T = any>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>(HttpMethod.GET, endpoint, options);
  }

  /**
   * Make a POST request
   * @param endpoint - API endpoint
   * @param data - Request data
   * @param options - Request options
   * @returns Promise resolving to API response
   */
  async post<T = any>(
    endpoint: string, 
    data?: any, 
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(HttpMethod.POST, endpoint, { ...options, body: data });
  }

  /**
   * Make a PUT request
   * @param endpoint - API endpoint
   * @param data - Request data
   * @param options - Request options
   * @returns Promise resolving to API response
   */
  async put<T = any>(
    endpoint: string, 
    data?: any, 
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(HttpMethod.PUT, endpoint, { ...options, body: data });
  }

  /**
   * Make a PATCH request
   * @param endpoint - API endpoint
   * @param data - Request data
   * @param options - Request options
   * @returns Promise resolving to API response
   */
  async patch<T = any>(
    endpoint: string, 
    data?: any, 
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(HttpMethod.PATCH, endpoint, { ...options, body: data });
  }

  /**
   * Make a DELETE request
   * @param endpoint - API endpoint
   * @param options - Request options
   * @returns Promise resolving to API response
   */
  async delete<T = any>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.request<T>(HttpMethod.DELETE, endpoint, options);
  }

  /**
   * Set authentication token
   * @param token - JWT token
   */
  setAuthToken(token: string): void {
    localStorage.setItem('auth_token', token);
  }

  /**
   * Get authentication token
   * @returns JWT token or null
   */
  getAuthToken(): string | null {
    return localStorage.getItem('auth_token');
  }

  /**
   * Remove authentication token
   */
  removeAuthToken(): void {
    localStorage.removeItem('auth_token');
  }

  /**
   * Update base URL
   * @param baseUrl - New base URL
   */
  updateBaseUrl(baseUrl: string): void {
    this.config.baseUrl = baseUrl;
  }

  /**
   * Update default headers
   * @param headers - New default headers
   */
  updateHeaders(headers: Record<string, string>): void {
    this.config.headers = { ...this.config.headers, ...headers };
  }
}

/**
 * Create a new API client instance
 * @param config - API configuration
 * @returns New API client instance
 * 
 * @example
 * ```typescript
 * const api = createApiClient({
 *   baseUrl: 'https://api.example.com',
 *   timeout: 15000
 * });
 * 
 * const users = await api.get('/users');
 * ```
 */
export function createApiClient(config: ApiConfig): ApiClient {
  return new ApiClient(config);
}

/**
 * Default API client instance
 */
export const api = createApiClient({
  baseUrl: process.env.REACT_APP_API_URL || 'http://localhost:3000/api',
  timeout: 10000
});

/**
 * Handle API errors
 * @param error - Error object
 * @returns Formatted error message
 */
export function handleApiError(error: any): string {
  if (error.response) {
    // Server responded with error status
    return error.response.data?.error || `Server error: ${error.response.status}`;
  } else if (error.request) {
    // Request was made but no response received
    return 'Network error: Unable to connect to server';
  } else {
    // Something else happened
    return error.message || 'An unexpected error occurred';
  }
}

/**
 * Check if response is successful
 * @param response - API response
 * @returns True if response is successful
 */
export function isSuccessResponse(response: ApiResponse): boolean {
  return response.success === true;
}

/**
 * Extract data from API response
 * @param response - API response
 * @returns Response data or null
 */
export function extractData<T>(response: ApiResponse<T>): T | null {
  return response.data || null;
}

/**
 * Extract error from API response
 * @param response - API response
 * @returns Error message or null
 */
export function extractError(response: ApiResponse): string | null {
  return response.error || null;
}