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

// Generate search results with real URLs (no fake prices)
function generateSearchResults(product) {
  const results = [];

  // Generate results for each source with real search URLs
  sources.forEach((source) => {
    results.push({
      source: source.name,
      url: source.formatUrl(product), // Real search URL for the product
      icon: source.icon
    });
  });

  return results;
}

// Main search function
async function searchPrices(product) {
  try {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 300));

    const results = generateSearchResults(product);

    return results.map(item => ({
      source: item.source,
      url: item.url,
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
