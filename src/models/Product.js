/**
 * @fileoverview Product model definition using Mongoose
 * @author API Documentation Generator
 * @version 1.0.0
 */

const mongoose = require('mongoose');

/**
 * Product schema definition
 * @typedef {Object} ProductSchema
 * @property {string} name - Product name (required)
 * @property {string} description - Product description (required)
 * @property {number} price - Product price in USD (required)
 * @property {string} category - Product category (required)
 * @property {string} brand - Product brand (required)
 * @property {number} stock - Available stock quantity (required)
 * @property {string[]} images - Array of product image URLs
 * @property {string[]} tags - Product tags for filtering
 * @property {boolean} isActive - Whether product is available for purchase
 * @property {Date} createdAt - Product creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 */
const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    minlength: [3, 'Product name must be at least 3 characters long'],
    maxlength: [100, 'Product name cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    trim: true,
    minlength: [10, 'Product description must be at least 10 characters long'],
    maxlength: [1000, 'Product description cannot exceed 1000 characters']
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0.01, 'Price must be greater than 0'],
    max: [999999.99, 'Price cannot exceed $999,999.99']
  },
  category: {
    type: String,
    required: [true, 'Product category is required'],
    trim: true,
    minlength: [2, 'Category must be at least 2 characters long'],
    maxlength: [50, 'Category cannot exceed 50 characters']
  },
  brand: {
    type: String,
    required: [true, 'Product brand is required'],
    trim: true,
    minlength: [2, 'Brand must be at least 2 characters long'],
    maxlength: [50, 'Brand cannot exceed 50 characters']
  },
  stock: {
    type: Number,
    required: [true, 'Stock quantity is required'],
    min: [0, 'Stock cannot be negative'],
    max: [999999, 'Stock cannot exceed 999,999']
  },
  images: [{
    type: String,
    validate: {
      validator: function(v) {
        return /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(v);
      },
      message: 'Image URL must be a valid image URL'
    }
  }],
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    minlength: [2, 'Tag must be at least 2 characters long'],
    maxlength: [30, 'Tag cannot exceed 30 characters']
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  sku: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true
  },
  weight: {
    type: Number,
    min: [0, 'Weight cannot be negative'],
    max: [999.99, 'Weight cannot exceed 999.99']
  },
  dimensions: {
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 }
  },
  rating: {
    average: { type: Number, min: 0, max: 5, default: 0 },
    count: { type: Number, min: 0, default: 0 }
  },
  featured: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      // Add virtual fields
      ret.isInStock = ret.stock > 0;
      ret.formattedPrice = `$${ret.price.toFixed(2)}`;
      return ret;
    }
  }
});

// Indexes for better query performance
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ category: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ price: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ rating: -1 });

// Virtual for stock status
productSchema.virtual('isInStock').get(function() {
  return this.stock > 0;
});

// Virtual for formatted price
productSchema.virtual('formattedPrice').get(function() {
  return `$${this.price.toFixed(2)}`;
});

// Pre-save middleware to generate SKU if not provided
productSchema.pre('save', function(next) {
  if (!this.sku) {
    const prefix = this.brand.substring(0, 3).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.sku = `${prefix}-${random}`;
  }
  next();
});

// Instance method to check if product is available
productSchema.methods.isAvailable = function() {
  return this.isActive && this.stock > 0;
};

// Instance method to reduce stock
productSchema.methods.reduceStock = function(quantity) {
  if (this.stock >= quantity) {
    this.stock -= quantity;
    return true;
  }
  return false;
};

// Instance method to add stock
productSchema.methods.addStock = function(quantity) {
  this.stock += quantity;
};

// Static method to find products by category
productSchema.statics.findByCategory = function(category) {
  return this.find({ category: new RegExp(category, 'i'), isActive: true });
};

// Static method to find products by brand
productSchema.statics.findByBrand = function(brand) {
  return this.find({ brand: new RegExp(brand, 'i'), isActive: true });
};

// Static method to find products in price range
productSchema.statics.findByPriceRange = function(minPrice, maxPrice) {
  return this.find({ 
    price: { $gte: minPrice, $lte: maxPrice }, 
    isActive: true 
  });
};

// Static method to find featured products
productSchema.statics.findFeatured = function() {
  return this.find({ featured: true, isActive: true });
};

// Static method to search products
productSchema.statics.search = function(searchTerm) {
  return this.find({
    $text: { $search: searchTerm },
    isActive: true
  }).sort({ score: { $meta: 'textScore' } });
};

const Product = mongoose.model('Product', productSchema);

module.exports = { Product };