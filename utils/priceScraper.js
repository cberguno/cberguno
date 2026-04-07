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

// Generate realistic product results with real search URLs
function generatePriceResults(product) {
  const results = [];
  const basePrice = Math.random() * 500 + 50;

  // Generate results for each source with real search URLs
  sources.forEach((source) => {
    const priceVariation = (Math.random() - 0.5) * 100; // ±$50 variation
    const price = Math.max(10, basePrice + priceVariation).toFixed(2);

    results.push({
      source: source.name,
      price,
      url: source.formatUrl(product), // Real search URL for the product
      inStock: Math.random() > 0.1, // 90% in stock
      icon: source.icon,
      rating: (Math.random() * 2 + 3.5).toFixed(1)
    });
  });

  return results;
}

// Main search function
async function searchPrices(product) {
  try {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 300));

    const results = generatePriceResults(product);

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
