/**
 * @fileoverview Product management routes and endpoints
 * @author API Documentation Generator
 * @version 1.0.0
 */

const express = require('express');
const { validateRequest } = require('../middleware/validation');
const { createProductSchema, updateProductSchema } = require('../schemas/productSchemas');
const { Product } = require('../models/Product');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Product:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique product identifier
 *           example: "507f1f77bcf86cd799439011"
 *         name:
 *           type: string
 *           description: Product name
 *           example: "Wireless Bluetooth Headphones"
 *         description:
 *           type: string
 *           description: Product description
 *           example: "High-quality wireless headphones with noise cancellation"
 *         price:
 *           type: number
 *           format: decimal
 *           description: Product price in USD
 *           example: 199.99
 *         category:
 *           type: string
 *           description: Product category
 *           example: "Electronics"
 *         brand:
 *           type: string
 *           description: Product brand
 *           example: "TechBrand"
 *         stock:
 *           type: integer
 *           minimum: 0
 *           description: Available stock quantity
 *           example: 50
 *         images:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of product image URLs
 *           example: ["https://example.com/image1.jpg", "https://example.com/image2.jpg"]
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           description: Product tags for filtering
 *           example: ["wireless", "bluetooth", "headphones", "audio"]
 *         isActive:
 *           type: boolean
 *           description: Whether the product is available for purchase
 *           example: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Product creation timestamp
 *           example: "2023-10-15T10:30:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *           example: "2023-10-15T10:30:00.000Z"
 *     CreateProductRequest:
 *       type: object
 *       required:
 *         - name
 *         - description
 *         - price
 *         - category
 *         - brand
 *         - stock
 *       properties:
 *         name:
 *           type: string
 *           minLength: 3
 *           maxLength: 100
 *           description: Product name
 *           example: "Wireless Bluetooth Headphones"
 *         description:
 *           type: string
 *           minLength: 10
 *           maxLength: 1000
 *           description: Product description
 *           example: "High-quality wireless headphones with noise cancellation"
 *         price:
 *           type: number
 *           minimum: 0.01
 *           description: Product price in USD
 *           example: 199.99
 *         category:
 *           type: string
 *           minLength: 2
 *           maxLength: 50
 *           description: Product category
 *           example: "Electronics"
 *         brand:
 *           type: string
 *           minLength: 2
 *           maxLength: 50
 *           description: Product brand
 *           example: "TechBrand"
 *         stock:
 *           type: integer
 *           minimum: 0
 *           description: Available stock quantity
 *           example: 50
 *         images:
 *           type: array
 *           items:
 *             type: string
 *             format: uri
 *           description: Array of product image URLs
 *           example: ["https://example.com/image1.jpg"]
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           description: Product tags for filtering
 *           example: ["wireless", "bluetooth"]
 *     UpdateProductRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           minLength: 3
 *           maxLength: 100
 *           description: Product name
 *         description:
 *           type: string
 *           minLength: 10
 *           maxLength: 1000
 *           description: Product description
 *         price:
 *           type: number
 *           minimum: 0.01
 *           description: Product price in USD
 *         category:
 *           type: string
 *           minLength: 2
 *           maxLength: 50
 *           description: Product category
 *         brand:
 *           type: string
 *           minLength: 2
 *           maxLength: 50
 *           description: Product brand
 *         stock:
 *           type: integer
 *           minimum: 0
 *           description: Available stock quantity
 *         images:
 *           type: array
 *           items:
 *             type: string
 *             format: uri
 *           description: Array of product image URLs
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           description: Product tags for filtering
 *         isActive:
 *           type: boolean
 *           description: Whether the product is available for purchase
 *     ProductListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Product'
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
 * /api/products:
 *   get:
 *     summary: Get all products
 *     description: Retrieves a paginated list of products with optional filtering and searching
 *     tags: [Products]
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
 *         description: Number of products per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for filtering products by name or description
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter products by category
 *       - in: query
 *         name: brand
 *         schema:
 *           type: string
 *         description: Filter products by brand
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Minimum price filter
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Maximum price filter
 *       - in: query
 *         name: inStock
 *         schema:
 *           type: boolean
 *         description: Filter products that are in stock
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [name, price, createdAt, updatedAt]
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
 *         description: Products retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProductListResponse'
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const category = req.query.category || '';
    const brand = req.query.brand || '';
    const minPrice = parseFloat(req.query.minPrice) || 0;
    const maxPrice = parseFloat(req.query.maxPrice) || Number.MAX_SAFE_INTEGER;
    const inStock = req.query.inStock === 'true';
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    
    const skip = (page - 1) * limit;

    // Build search query
    const searchQuery = {
      isActive: true,
      price: { $gte: minPrice, $lte: maxPrice }
    };

    if (search) {
      searchQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    if (category) {
      searchQuery.category = { $regex: category, $options: 'i' };
    }

    if (brand) {
      searchQuery.brand = { $regex: brand, $options: 'i' };
    }

    if (inStock) {
      searchQuery.stock = { $gt: 0 };
    }

    // Get products with pagination
    const products = await Product.find(searchQuery)
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit);

    const total = await Product.countDocuments(searchQuery);
    const pages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: products,
      pagination: {
        page,
        limit,
        total,
        pages
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve products',
      details: 'An error occurred while fetching the product list'
    });
  }
});

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Get product by ID
 *     description: Retrieves a specific product by its unique identifier
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique product identifier
 *         example: "507f1f77bcf86cd799439011"
 *     responses:
 *       200:
 *         description: Product retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
        details: 'The requested product could not be found'
      });
    }

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve product',
      details: 'An error occurred while fetching the product'
    });
  }
});

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create new product
 *     description: Creates a new product in the system
 *     tags: [Products]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateProductRequest'
 *           examples:
 *             electronics:
 *               summary: Electronics product
 *               value:
 *                 name: "Wireless Bluetooth Headphones"
 *                 description: "High-quality wireless headphones with noise cancellation and 30-hour battery life"
 *                 price: 199.99
 *                 category: "Electronics"
 *                 brand: "TechBrand"
 *                 stock: 50
 *                 images: ["https://example.com/headphones1.jpg", "https://example.com/headphones2.jpg"]
 *                 tags: ["wireless", "bluetooth", "headphones", "audio", "noise-cancellation"]
 *             clothing:
 *               summary: Clothing product
 *               value:
 *                 name: "Cotton T-Shirt"
 *                 description: "Comfortable 100% cotton t-shirt available in multiple colors"
 *                 price: 24.99
 *                 category: "Clothing"
 *                 brand: "FashionBrand"
 *                 stock: 100
 *                 images: ["https://example.com/tshirt1.jpg"]
 *                 tags: ["cotton", "t-shirt", "casual", "comfortable"]
 *     responses:
 *       201:
 *         description: Product created successfully
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
 *                   example: "Product created successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 *       400:
 *         description: Invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', validateRequest(createProductSchema), async (req, res) => {
  try {
    const productData = {
      ...req.body,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const product = new Product(productData);
    await product.save();

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create product',
      details: 'An error occurred while creating the product'
    });
  }
});

/**
 * @swagger
 * /api/products/{id}:
 *   put:
 *     summary: Update product
 *     description: Updates an existing product by its unique identifier
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique product identifier
 *         example: "507f1f77bcf86cd799439011"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProductRequest'
 *           examples:
 *             updatePrice:
 *               summary: Update product price
 *               value:
 *                 price: 179.99
 *             updateStock:
 *               summary: Update stock and description
 *               value:
 *                 stock: 75
 *                 description: "Updated description with new features"
 *     responses:
 *       200:
 *         description: Product updated successfully
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
 *                   example: "Product updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 *       400:
 *         description: Invalid input data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put('/:id', validateRequest(updateProductSchema), async (req, res) => {
  try {
    const updateData = {
      ...req.body,
      updatedAt: new Date()
    };

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
        details: 'The requested product could not be found'
      });
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: product
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product',
      details: 'An error occurred while updating the product'
    });
  }
});

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Delete product
 *     description: Soft deletes a product by setting isActive to false
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique product identifier
 *         example: "507f1f77bcf86cd799439011"
 *     responses:
 *       200:
 *         description: Product deleted successfully
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
 *                   example: "Product deleted successfully"
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete('/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { isActive: false, updatedAt: new Date() },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
        details: 'The requested product could not be found'
      });
    }

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete product',
      details: 'An error occurred while deleting the product'
    });
  }
});

module.exports = router;