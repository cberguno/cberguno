/**
 * @fileoverview Order management routes and endpoints
 * @author API Documentation Generator
 * @version 1.0.0
 */

const express = require('express');
const { validateRequest } = require('../middleware/validation');
const { createOrderSchema, updateOrderStatusSchema } = require('../schemas/orderSchemas');
const { Order } = require('../models/Order');
const { Product } = require('../models/Product');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     OrderItem:
 *       type: object
 *       required:
 *         - productId
 *         - quantity
 *         - price
 *       properties:
 *         productId:
 *           type: string
 *           description: Unique product identifier
 *           example: "507f1f77bcf86cd799439011"
 *         productName:
 *           type: string
 *           description: Product name at time of order
 *           example: "Wireless Bluetooth Headphones"
 *         quantity:
 *           type: integer
 *           minimum: 1
 *           description: Quantity ordered
 *           example: 2
 *         price:
 *           type: number
 *           format: decimal
 *           description: Price per unit at time of order
 *           example: 199.99
 *         total:
 *           type: number
 *           format: decimal
 *           description: Total price for this item (quantity * price)
 *           example: 399.98
 *     ShippingAddress:
 *       type: object
 *       required:
 *         - street
 *         - city
 *         - state
 *         - zipCode
 *         - country
 *       properties:
 *         street:
 *           type: string
 *           description: Street address
 *           example: "123 Main Street"
 *         city:
 *           type: string
 *           description: City name
 *           example: "New York"
 *         state:
 *           type: string
 *           description: State or province
 *           example: "NY"
 *         zipCode:
 *           type: string
 *           description: ZIP or postal code
 *           example: "10001"
 *         country:
 *           type: string
 *           description: Country code
 *           example: "US"
 *     Order:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique order identifier
 *           example: "507f1f77bcf86cd799439011"
 *         userId:
 *           type: string
 *           description: User who placed the order
 *           example: "507f1f77bcf86cd799439012"
 *         orderNumber:
 *           type: string
 *           description: Human-readable order number
 *           example: "ORD-2023-001234"
 *         items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/OrderItem'
 *         subtotal:
 *           type: number
 *           format: decimal
 *           description: Subtotal before taxes and shipping
 *           example: 399.98
 *         tax:
 *           type: number
 *           format: decimal
 *           description: Tax amount
 *           example: 32.00
 *         shipping:
 *           type: number
 *           format: decimal
 *           description: Shipping cost
 *           example: 9.99
 *         total:
 *           type: number
 *           format: decimal
 *           description: Total order amount
 *           example: 441.97
 *         status:
 *           type: string
 *           enum: [pending, confirmed, processing, shipped, delivered, cancelled]
 *           description: Current order status
 *           example: "pending"
 *         shippingAddress:
 *           $ref: '#/components/schemas/ShippingAddress'
 *         paymentMethod:
 *           type: string
 *           description: Payment method used
 *           example: "credit_card"
 *         paymentStatus:
 *           type: string
 *           enum: [pending, paid, failed, refunded]
 *           description: Payment status
 *           example: "paid"
 *         trackingNumber:
 *           type: string
 *           description: Shipping tracking number
 *           example: "1Z999AA1234567890"
 *         notes:
 *           type: string
 *           description: Order notes or special instructions
 *           example: "Please leave package at front door"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Order creation timestamp
 *           example: "2023-10-15T10:30:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *           example: "2023-10-15T10:30:00.000Z"
 *     CreateOrderRequest:
 *       type: object
 *       required:
 *         - items
 *         - shippingAddress
 *         - paymentMethod
 *       properties:
 *         items:
 *           type: array
 *           minItems: 1
 *           items:
 *             type: object
 *             required:
 *               - productId
 *               - quantity
 *             properties:
 *               productId:
 *                 type: string
 *                 description: Product ID to order
 *                 example: "507f1f77bcf86cd799439011"
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 description: Quantity to order
 *                 example: 2
 *         shippingAddress:
 *           $ref: '#/components/schemas/ShippingAddress'
 *         paymentMethod:
 *           type: string
 *           description: Payment method
 *           example: "credit_card"
 *         notes:
 *           type: string
 *           description: Order notes
 *           example: "Please leave package at front door"
 *     UpdateOrderStatusRequest:
 *       type: object
 *       required:
 *         - status
 *       properties:
 *         status:
 *           type: string
 *           enum: [pending, confirmed, processing, shipped, delivered, cancelled]
 *           description: New order status
 *           example: "shipped"
 *         trackingNumber:
 *           type: string
 *           description: Shipping tracking number
 *           example: "1Z999AA1234567890"
 *         notes:
 *           type: string
 *           description: Additional notes
 *           example: "Package shipped via UPS"
 *     OrderListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Order'
 *         pagination:
 *           type: object
 *           properties:
 *             page:
 *               type: integer
 *               example: 1
 *             limit:
 *               type: integer
 *               example: 10
 *             total:
 *               type: integer
 *               example: 25
 *             pages:
 *               type: integer
 *               example: 3
 */

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: Get user orders
 *     description: Retrieves a paginated list of orders for the currently authenticated user
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of orders per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, confirmed, processing, shipped, delivered, cancelled]
 *         description: Filter orders by status
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, total, status]
 *           default: createdAt
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Orders retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderListResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || '';
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    
    const skip = (page - 1) * limit;

    // Build query
    const query = { userId };
    if (status) {
      query.status = status;
    }

    // Get orders with pagination
    const orders = await Order.find(query)
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit);

    const total = await Order.countDocuments(query);
    const pages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page,
        limit,
        total,
        pages
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve orders',
      details: 'An error occurred while fetching the order list'
    });
  }
});

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     summary: Get order by ID
 *     description: Retrieves a specific order by its unique identifier
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique order identifier
 *         example: "507f1f77bcf86cd799439011"
 *     responses:
 *       200:
 *         description: Order retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Order'
 *       404:
 *         description: Order not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden - Order belongs to another user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        details: 'The requested order could not be found'
      });
    }

    // Check if order belongs to the authenticated user
    if (order.userId.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        details: 'You can only view your own orders'
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve order',
      details: 'An error occurred while fetching the order'
    });
  }
});

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Create new order
 *     description: Creates a new order for the currently authenticated user
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOrderRequest'
 *           examples:
 *             electronicsOrder:
 *               summary: Electronics order
 *               value:
 *                 items:
 *                   - productId: "507f1f77bcf86cd799439011"
 *                     quantity: 1
 *                   - productId: "507f1f77bcf86cd799439012"
 *                     quantity: 2
 *                 shippingAddress:
 *                   street: "123 Main Street"
 *                   city: "New York"
 *                   state: "NY"
 *                   zipCode: "10001"
 *                   country: "US"
 *                 paymentMethod: "credit_card"
 *                 notes: "Please leave package at front door"
 *     responses:
 *       201:
 *         description: Order created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Order created successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Order'
 *       400:
 *         description: Invalid input data or insufficient stock
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', validateRequest(createOrderSchema), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { items, shippingAddress, paymentMethod, notes } = req.body;

    // Validate products and calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      
      if (!product) {
        return res.status(400).json({
          success: false,
          error: 'Product not found',
          details: `Product with ID ${item.productId} does not exist`
        });
      }

      if (!product.isActive) {
        return res.status(400).json({
          success: false,
          error: 'Product unavailable',
          details: `Product ${product.name} is no longer available`
        });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient stock',
          details: `Only ${product.stock} units available for ${product.name}`
        });
      }

      const itemTotal = product.price * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        productId: product._id,
        productName: product.name,
        quantity: item.quantity,
        price: product.price,
        total: itemTotal
      });
    }

    // Calculate taxes and shipping (simplified)
    const tax = subtotal * 0.08; // 8% tax
    const shipping = subtotal > 100 ? 0 : 9.99; // Free shipping over $100
    const total = subtotal + tax + shipping;

    // Generate order number
    const orderNumber = `ORD-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

    // Create order
    const order = new Order({
      userId,
      orderNumber,
      items: orderItems,
      subtotal,
      tax,
      shipping,
      total,
      status: 'pending',
      shippingAddress,
      paymentMethod,
      paymentStatus: 'pending',
      notes,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await order.save();

    // Update product stock
    for (const item of items) {
      await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stock: -item.quantity } }
      );
    }

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: order
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create order',
      details: 'An error occurred while creating the order'
    });
  }
});

/**
 * @swagger
 * /api/orders/{id}/status:
 *   put:
 *     summary: Update order status
 *     description: Updates the status of an existing order (Admin only)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique order identifier
 *         example: "507f1f77bcf86cd799439011"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateOrderStatusRequest'
 *           examples:
 *             markShipped:
 *               summary: Mark order as shipped
 *               value:
 *                 status: "shipped"
 *                 trackingNumber: "1Z999AA1234567890"
 *                 notes: "Package shipped via UPS"
 *             markDelivered:
 *               summary: Mark order as delivered
 *               value:
 *                 status: "delivered"
 *                 notes: "Package delivered successfully"
 *     responses:
 *       200:
 *         description: Order status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Order status updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Order'
 *       400:
 *         description: Invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Order not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put('/:id/status', validateRequest(updateOrderStatusRequest), async (req, res) => {
  try {
    const { status, trackingNumber, notes } = req.body;
    
    const updateData = {
      status,
      updatedAt: new Date()
    };

    if (trackingNumber) {
      updateData.trackingNumber = trackingNumber;
    }

    if (notes) {
      updateData.notes = notes;
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        details: 'The requested order could not be found'
      });
    }

    res.json({
      success: true,
      message: 'Order status updated successfully',
      data: order
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update order status',
      details: 'An error occurred while updating the order status'
    });
  }
});

module.exports = router;