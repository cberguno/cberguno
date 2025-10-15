/**
 * @fileoverview TypeScript type definitions for user-related entities
 * @author API Documentation Generator
 * @version 1.0.0
 */

/**
 * User entity interface
 * @interface User
 */
export interface User {
  /** Unique user identifier */
  id: string;
  /** User's email address */
  email: string;
  /** User's first name */
  firstName: string;
  /** User's last name */
  lastName: string;
  /** User's full name (computed) */
  fullName?: string;
  /** User's role in the system */
  role: UserRole;
  /** Whether the user account is active */
  isActive: boolean;
  /** Whether the user's email is verified */
  emailVerified: boolean;
  /** User's last login timestamp */
  lastLogin?: Date;
  /** Account creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * User role enumeration
 * @enum {string}
 */
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin'
}

/**
 * Request interface for updating user profile
 * @interface UpdateUserRequest
 */
export interface UpdateUserRequest {
  /** User's first name */
  firstName?: string;
  /** User's last name */
  lastName?: string;
  /** User's email address */
  email?: string;
}

/**
 * Request interface for changing user password
 * @interface ChangePasswordRequest
 */
export interface ChangePasswordRequest {
  /** Current password */
  currentPassword: string;
  /** New password */
  newPassword: string;
  /** Confirm new password */
  confirmPassword: string;
}

/**
 * Request interface for user registration
 * @interface RegisterRequest
 */
export interface RegisterRequest {
  /** User's email address */
  email: string;
  /** User's password */
  password: string;
  /** User's first name */
  firstName: string;
  /** User's last name */
  lastName: string;
}

/**
 * Request interface for user login
 * @interface LoginRequest
 */
export interface LoginRequest {
  /** User's email address */
  email: string;
  /** User's password */
  password: string;
}

/**
 * Response interface for authentication
 * @interface AuthResponse
 */
export interface AuthResponse {
  /** Whether the operation was successful */
  success: boolean;
  /** Response message */
  message: string;
  /** JWT access token */
  token: string;
  /** User information */
  user: User;
}

/**
 * User preferences interface
 * @interface UserPreferences
 */
export interface UserPreferences {
  /** Whether to receive email notifications */
  emailNotifications: boolean;
  /** Whether to receive SMS notifications */
  smsNotifications: boolean;
  /** Whether to receive newsletter */
  newsletter: boolean;
  /** User's preferred language */
  language: string;
  /** User's timezone */
  timezone: string;
  /** User's preferred date format */
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
}

/**
 * User query parameters interface
 * @interface UserQueryParams
 */
export interface UserQueryParams {
  /** Page number for pagination */
  page?: number;
  /** Number of items per page */
  limit?: number;
  /** Search term for filtering users */
  search?: string;
  /** Filter by user role */
  role?: UserRole;
  /** Filter by active status */
  isActive?: boolean;
  /** Field to sort by */
  sortBy?: 'firstName' | 'lastName' | 'email' | 'createdAt' | 'updatedAt';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated user list response interface
 * @interface UserListResponse
 */
export interface UserListResponse {
  /** Whether the operation was successful */
  success: boolean;
  /** Array of users */
  data: User[];
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
 * User statistics interface
 * @interface UserStatistics
 */
export interface UserStatistics {
  /** Total number of users */
  totalUsers: number;
  /** Number of active users */
  activeUsers: number;
  /** Number of inactive users */
  inactiveUsers: number;
  /** Number of admin users */
  adminUsers: number;
  /** Number of regular users */
  regularUsers: number;
  /** Users registered this month */
  newUsersThisMonth: number;
  /** Users registered this year */
  newUsersThisYear: number;
}

/**
 * User activity log interface
 * @interface UserActivity
 */
export interface UserActivity {
  /** Activity ID */
  id: string;
  /** User ID */
  userId: string;
  /** Activity type */
  type: ActivityType;
  /** Activity description */
  description: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
  /** Activity timestamp */
  timestamp: Date;
  /** IP address */
  ipAddress?: string;
  /** User agent */
  userAgent?: string;
}

/**
 * Activity type enumeration
 * @enum {string}
 */
export enum ActivityType {
  LOGIN = 'login',
  LOGOUT = 'logout',
  REGISTRATION = 'registration',
  PROFILE_UPDATE = 'profile_update',
  PASSWORD_CHANGE = 'password_change',
  EMAIL_VERIFICATION = 'email_verification',
  PASSWORD_RESET = 'password_reset',
  ACCOUNT_DEACTIVATION = 'account_deactivation',
  ACCOUNT_REACTIVATION = 'account_reactivation'
}