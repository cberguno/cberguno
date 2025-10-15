/**
 * @fileoverview Authentication middleware for JWT token verification
 * @author API Documentation Generator
 * @version 1.0.0
 */

const jwt = require('jsonwebtoken');
const { User } = require('../models/User');

/**
 * Middleware to authenticate JWT tokens
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {void}
 * 
 * @example
 * // Usage in routes
 * router.get('/protected', authenticateToken, (req, res) => {
 *   res.json({ message: 'Access granted', user: req.user });
 * });
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access token required',
        details: 'Please provide a valid access token in the Authorization header'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    // Get user from database
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        details: 'User associated with this token no longer exists'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Account deactivated',
        details: 'Your account has been deactivated'
      });
    }

    // Add user info to request object
    req.user = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        details: 'The provided token is malformed or invalid'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        details: 'The provided token has expired. Please login again'
      });
    }

    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      details: 'An error occurred while verifying the token'
    });
  }
};

/**
 * Middleware to check if user has admin role
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {void}
 * 
 * @example
 * // Usage in admin routes
 * router.get('/admin/users', authenticateToken, requireAdmin, (req, res) => {
 *   // Admin-only logic here
 * });
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      details: 'Please authenticate before accessing this resource'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required',
      details: 'This resource requires administrator privileges'
    });
  }

  next();
};

/**
 * Middleware to check if user owns the resource or is admin
 * @param {string} userIdParam - Name of the parameter containing user ID
 * @returns {Function} Middleware function
 * 
 * @example
 * // Usage in routes
 * router.get('/users/:userId/profile', authenticateToken, requireOwnershipOrAdmin('userId'), (req, res) => {
 *   // User can access their own profile or admin can access any profile
 * });
 */
const requireOwnershipOrAdmin = (userIdParam = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        details: 'Please authenticate before accessing this resource'
      });
    }

    const resourceUserId = req.params[userIdParam];
    const isOwner = req.user.userId === resourceUserId;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        details: 'You can only access your own resources'
      });
    }

    next();
  };
};

/**
 * Middleware to optionally authenticate (doesn't fail if no token)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {void}
 * 
 * @example
 * // Usage in routes that work with or without authentication
 * router.get('/public-data', optionalAuth, (req, res) => {
 *   if (req.user) {
 *     // Return personalized data
 *   } else {
 *     // Return public data
 *   }
 * });
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      const user = await User.findById(decoded.userId).select('-password');
      
      if (user && user.isActive) {
        req.user = {
          userId: user._id.toString(),
          email: user.email,
          role: user.role
        };
      }
    }

    next();
  } catch (error) {
    // Ignore authentication errors for optional auth
    next();
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireOwnershipOrAdmin,
  optionalAuth
};