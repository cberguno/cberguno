const express = require('express');
const cors = require('cors');
const path = require('path');
const priceScraper = require('./utils/priceScraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Price comparison API endpoint
app.post('/api/search', async (req, res) => {
  try {
    const { product } = req.body;

    if (!product || product.trim() === '') {
      return res.status(400).json({ error: 'Product name is required' });
    }

    // Search across multiple sources
    const results = await priceScraper.searchPrices(product.trim());

    // Sort by price (lowest to highest)
    results.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    res.json({
      product,
      count: results.length,
      results
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search for prices' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Price Comparison Tool running on http://localhost:${PORT}`);
});
