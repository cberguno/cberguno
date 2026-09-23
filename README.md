# 💰 Price Comparison Tool

A powerful web application that helps you find the best online prices for products by searching across multiple retailers and displaying results sorted from lowest to highest price.

## Features

✨ **Multi-Source Searching** - Search across Amazon, eBay, Walmart, Best Buy, and Target
📊 **Price Comparison** - See prices from different retailers side-by-side
🔄 **Automatic Sorting** - Results automatically sorted by lowest price first
📈 **Statistics** - View lowest price, average price, price range, and best deal
💻 **Responsive Design** - Works great on desktop, tablet, and mobile devices
⚡ **Fast Results** - Quick search performance with simulated API calls
🏪 **Stock Status** - See which retailers have products in stock

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd price-comparison-tool
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

### Development

For development with auto-reload:
```bash
npm run dev
```

## Usage

1. Enter a product name in the search box (e.g., "iPhone 15", "Laptop", "Headphones")
2. Click the "Search" button or press Enter
3. View results sorted by price from lowest to highest
4. Click "View Deal" to visit the retailer’s website
5. Check statistics for price insights

## Project Structure

```
├── server.js              # Express server
├── package.json          # Dependencies
├── public/
│   ├── index.html       # Main HTML file
│   ├── styles.css       # CSS styling
│   └── script.js        # Frontend JavaScript
├── utils/
│   └── priceScraper.js  # Price scraping logic
└── README.md            # This file
```

## API Endpoints

### POST /api/search
Search for product prices

**Request:**
```json
{
  "product": "iPhone 15"
}
```

**Response:**
```json
{
  "product": "iPhone 15",
  "count": 5,
  "results": [
    {
      "source": "Amazon",
      "price": "799.99",
      "url": "https://amazon.com/...",
      "inStock": true,
      "rating": "4.5",
      "icon": "🛒"
    }
  ]
}
```

### GET /api/health
Health check endpoint

## Mock Data

The tool includes mock product data for testing. Sample searches:
- "iPhone 15"
- "Laptop"
- "Headphones"
- "USB-C Cable"
- "Keyboard"

## Future Enhancements

- Real API integrations with retailers
- Web scraping with Puppeteer
- Browser extension
- Price tracking over time
- Wishlist functionality
- Email price alerts
- Product reviews aggregation

## Technologies Used

- **Backend**: Express.js, Node.js
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Styling**: Modern CSS with gradients and animations
- **HTTP Client**: Axios

## License

MIT License - feel free to use this project for any purpose

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
