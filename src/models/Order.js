/**
 * @fileoverview Order model definition using Mongoose
 * @author API Documentation Generator
 * @version 1.0.0
 */

const mongoose = require('mongoose');

/**
 * Order item schema definition
 * @typedef {Object} OrderItemSchema
 * @property {ObjectId} productId - Reference to Product
 * @property {string} productName - Product name at time of order
 * @property {number} quantity - Quantity ordered
 * @property {number} price - Price per unit at time of order
 * @property {number} total - Total price for this item
 */
const orderItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: {
    type: String,
    required: true,
    trim: true
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1'],
    max: [999, 'Quantity cannot exceed 999']
  },
  price: {
    type: Number,
    required: true,
    min: [0, 'Price cannot be negative']
  },
  total: {
    type: Number,
    required: true,
    min: [0, 'Total cannot be negative']
  }
}, { _id: false });

/**
 * Shipping address schema definition
 * @typedef {Object} ShippingAddressSchema
 * @property {string} street - Street address
 * @property {string} city - City name
 * @property {string} state - State or province
 * @property {string} zipCode - ZIP or postal code
 * @property {string} country - Country code
 */
const shippingAddressSchema = new mongoose.Schema({
  street: {
    type: String,
    required: [true, 'Street address is required'],
    trim: true,
    maxlength: [100, 'Street address cannot exceed 100 characters']
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true,
    maxlength: [50, 'City cannot exceed 50 characters']
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true,
    maxlength: [50, 'State cannot exceed 50 characters']
  },
  zipCode: {
    type: String,
    required: [true, 'ZIP code is required'],
    trim: true,
    match: [/^\d{5}(-\d{4})?$/, 'Please enter a valid ZIP code']
  },
  country: {
    type: String,
    required: [true, 'Country is required'],
    trim: true,
    maxlength: [2, 'Country must be a 2-letter code'],
    uppercase: true
  }
}, { _id: false });

/**
 * Order schema definition
 * @typedef {Object} OrderSchema
 * @property {ObjectId} userId - Reference to User
 * @property {string} orderNumber - Human-readable order number
 * @property {OrderItemSchema[]} items - Array of order items
 * @property {number} subtotal - Subtotal before taxes and shipping
 * @property {number} tax - Tax amount
 * @property {number} shipping - Shipping cost
 * @property {number} total - Total order amount
 * @property {string} status - Current order status
 * @property {ShippingAddressSchema} shippingAddress - Shipping address
 * @property {string} paymentMethod - Payment method used
 * @property {string} paymentStatus - Payment status
 * @property {string} trackingNumber - Shipping tracking number
 * @property {string} notes - Order notes
 * @property {Date} createdAt - Order creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 */
const orderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orderNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  items: [orderItemSchema],
  subtotal: {
    type: Number,
    required: true,
    min: [0, 'Subtotal cannot be negative']
  },
  tax: {
    type: Number,
    required: true,
    min: [0, 'Tax cannot be negative']
  },
  shipping: {
    type: Number,
    required: true,
    min: [0, 'Shipping cannot be negative']
  },
  total: {
    type: Number,
    required: true,
    min: [0, 'Total cannot be negative']
  },
  status: {
    type: String,
    enum: {
      values: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
      message: 'Status must be one of: pending, confirmed, processing, shipped, delivered, cancelled'
    },
    default: 'pending'
  },
  shippingAddress: {
    type: shippingAddressSchema,
    required: true
  },
  paymentMethod: {
    type: String,
    required: [true, 'Payment method is required'],
    enum: ['credit_card', 'debit_card', 'paypal', 'bank_transfer', 'cash_on_delivery']
  },
  paymentStatus: {
    type: String,
    enum: {
      values: ['pending', 'paid', 'failed', 'refunded'],
      message: 'Payment status must be one of: pending, paid, failed, refunded'
    },
    default: 'pending'
  },
  trackingNumber: {
    type: String,
    trim: true
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  estimatedDelivery: {
    type: Date
  },
  actualDelivery: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      // Add virtual fields
      ret.itemCount = ret.items.length;
      ret.formattedTotal = `$${ret.total.toFixed(2)}`;
      ret.formattedSubtotal = `$${ret.subtotal.toFixed(2)}`;
      ret.formattedTax = `$${ret.tax.toFixed(2)}`;
      ret.formattedShipping = `$${ret.shipping.toFixed(2)}`;
      return ret;
    }
  }
});

// Indexes for better query performance
orderSchema.index({ userId: 1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ paymentStatus: 1 });

// Virtual for item count
orderSchema.virtual('itemCount').get(function() {
  return this.items.length;
});

// Virtual for formatted total
orderSchema.virtual('formattedTotal').get(function() {
  return `$${this.total.toFixed(2)}`;
});

// Virtual for formatted subtotal
orderSchema.virtual('formattedSubtotal').get(function() {
  return `$${this.subtotal.toFixed(2)}`;
});

// Virtual for formatted tax
orderSchema.virtual('formattedTax').get(function() {
  return `$${this.tax.toFixed(2)}`;
});

// Virtual for formatted shipping
orderSchema.virtual('formattedShipping').get(function() {
  return `$${this.shipping.toFixed(2)}`;
});

// Pre-save middleware to calculate totals
orderSchema.pre('save', function(next) {
  if (this.isModified('items')) {
    this.subtotal = this.items.reduce((sum, item) => sum + item.total, 0);
    this.total = this.subtotal + this.tax + this.shipping;
  }
  next();
});

// Instance method to check if order can be cancelled
orderSchema.methods.canBeCancelled = function() {
  return ['pending', 'confirmed'].includes(this.status);
};

// Instance method to check if order can be updated
orderSchema.methods.canBeUpdated = function() {
  return !['delivered', 'cancelled'].includes(this.status);
};

// Instance method to add tracking number
orderSchema.methods.addTracking = function(trackingNumber) {
  this.trackingNumber = trackingNumber;
  this.status = 'shipped';
};

// Instance method to mark as delivered
orderSchema.methods.markAsDelivered = function() {
  this.status = 'delivered';
  this.actualDelivery = new Date();
};

// Static method to find orders by user
orderSchema.statics.findByUser = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

// Static method to find orders by status
orderSchema.statics.findByStatus = function(status) {
  return this.find({ status }).sort({ createdAt: -1 });
};

// Static method to find orders by date range
orderSchema.statics.findByDateRange = function(startDate, endDate) {
  return this.find({
    createdAt: {
      $gte: startDate,
      $lte: endDate
    }
  }).sort({ createdAt: -1 });
};

// Static method to get order statistics
orderSchema.statics.getStatistics = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalValue: { $sum: '$total' }
      }
    }
  ]);
};

const Order = mongoose.model('Order', orderSchema);

module.exports = { Order };