const axios = require('axios');

// Mock data sources - in production, these would be real API integrations
const sources = [
  {
    name: 'Amazon',
    baseUrl: 'https://www.amazon.com/s',
    formatUrl: (product) => `https://www.amazon.com/s?k=${encodeURIComponent(product)}`,
    icon: '🛒'
  },
  {
    name: 'eBay',
    baseUrl: 'https://www.ebay.com/sch/i.html',
    formatUrl: (product) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(product)}`,
    icon: '🏪'
  },
  {
    name: 'Walmart',
    baseUrl: 'https://www.walmart.com/search',
    formatUrl: (product) => `https://www.walmart.com/search?q=${encodeURIComponent(product)}`,
    icon: '🏬'
  },
  {
    name: 'Best Buy',
    baseUrl: 'https://www.bestbuy.com/site/searchpage.jsp',
    formatUrl: (product) => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(product)}`,
    icon: '🔌'
  },
  {
    name: 'Target',
    baseUrl: 'https://www.target.com/s',
    formatUrl: (product) => `https://www.target.com/s?searchTerm=${encodeURIComponent(product)}`,
    icon: '🎯'
  }
];

// Mock product database with realistic pricing
const mockProducts = {
  'iphone 15': [
    { source: 'Amazon', price: '799.99', url: 'https://amazon.com/Apple-iPhone-15/dp/B0CHX1QXTS', inStock: true },
    { source: 'Best Buy', price: '799.99', url: 'https://bestbuy.com/iPhone-15', inStock: true },
    { source: 'Target', price: '799.99', url: 'https://target.com/iPhone-15', inStock: true },
    { source: 'Walmart', price: '829.99', url: 'https://walmart.com/Apple-iPhone-15', inStock: true },
    { source: 'eBay', price: '749.99', url: 'https://ebay.com/iPhone-15', inStock: true }
  ],
  'laptop': [
    { source: 'Amazon', price: '599.99', url: 'https://amazon.com/laptops', inStock: true },
    { source: 'Best Buy', price: '549.99', url: 'https://bestbuy.com/laptops', inStock: true },
    { source: 'Walmart', price: '699.99', url: 'https://walmart.com/laptops', inStock: false },
    { source: 'eBay', price: '579.99', url: 'https://ebay.com/laptops', inStock: true }
  ],
  'headphones': [
    { source: 'Amazon', price: '149.99', url: 'https://amazon.com/headphones', inStock: true },
    { source: 'Best Buy', price: '129.99', url: 'https://bestbuy.com/headphones', inStock: true },
    { source: 'Target', price: '159.99', url: 'https://target.com/headphones', inStock: true },
    { source: 'Walmart', price: '139.99', url: 'https://walmart.com/headphones', inStock: true },
    { source: 'eBay', price: '99.99', url: 'https://ebay.com/headphones', inStock: true }
  ],
  'usb-c cable': [
    { source: 'Amazon', price: '9.99', url: 'https://amazon.com/usb-c-cable', inStock: true },
    { source: 'Best Buy', price: '12.99', url: 'https://bestbuy.com/usb-c-cable', inStock: true },
    { source: 'Target', price: '10.99', url: 'https://target.com/usb-c-cable', inStock: true },
    { source: 'Walmart', price: '8.99', url: 'https://walmart.com/usb-c-cable', inStock: true },
    { source: 'eBay', price: '7.99', url: 'https://ebay.com/usb-c-cable', inStock: true }
  ],
  'keyboard': [
    { source: 'Amazon', price: '49.99', url: 'https://amazon.com/keyboard', inStock: true },
    { source: 'Best Buy', price: '59.99', url: 'https://bestbuy.com/keyboard', inStock: true },
    { source: 'Walmart', price: '39.99', url: 'https://walmart.com/keyboard', inStock: true },
    { source: 'eBay', price: '44.99', url: 'https://ebay.com/keyboard', inStock: true }
  ]
};

// Generate realistic product results based on search query
function generateMockResults(product) {
  const searchTerm = product.toLowerCase();

  // Check for exact or close matches in mock database
  const exactMatch = Object.keys(mockProducts).find(key =>
    key.includes(searchTerm) || searchTerm.includes(key)
  );

  if (exactMatch && mockProducts[exactMatch]) {
    return mockProducts[exactMatch].map(item => ({
      ...item,
      savings: calculateSavings(item.price),
      rating: (Math.random() * 2 + 3.5).toFixed(1) // Random rating 3.5-5.5
    }));
  }

  // Generate random results for unknown products
  const results = [];
  const basePrice = Math.random() * 500 + 50;

  sources.forEach((source, index) => {
    const priceVariation = (Math.random() - 0.5) * 100; // ±$50 variation
    const price = Math.max(10, basePrice + priceVariation).toFixed(2);

    results.push({
      source: source.name,
      price,
      url: source.formatUrl(product),
      inStock: Math.random() > 0.1, // 90% in stock
      icon: source.icon,
      rating: (Math.random() * 2 + 3.5).toFixed(1),
      savings: calculateSavings(price)
    });
  });

  return results;
}

function calculateSavings(price) {
  const numPrice = parseFloat(price);
  const maxPrice = 1000; // Assumed max price for savings calculation
  const savings = Math.max(0, maxPrice - numPrice);
  return savings.toFixed(2);
}

// Main search function
async function searchPrices(product) {
  try {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 300));

    const results = generateMockResults(product);

    return results.map(item => ({
      source: item.source,
      price: item.price,
      url: item.url,
      inStock: item.inStock,
      rating: item.rating,
      icon: item.icon || '🔗'
    }));
  } catch (error) {
    console.error('Error searching prices:', error);
    return [];
  }
}

module.exports = {
  searchPrices,
  sources
};
