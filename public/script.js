const searchForm = document.getElementById('searchForm');
const productInput = document.getElementById('productInput');
const resultsSection = document.getElementById('resultsSection');
const statsSection = document.getElementById('statsSection');
const resultsContainer = document.getElementById('resultsContainer');
const loadingMessage = document.getElementById('loadingMessage');
const noResults = document.getElementById('noResults');
const searchTermElement = document.getElementById('searchTerm');
const resultCountElement = document.getElementById('resultCount');

// Handle form submission
searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const product = productInput.value.trim();

    if (!product) {
        alert('Please enter a product name');
        return;
    }

    await performSearch(product);
});

async function performSearch(product) {
    // Show results section and loading state
    resultsSection.style.display = 'block';
    statsSection.style.display = 'none';
    loadingMessage.style.display = 'block';
    resultsContainer.innerHTML = '';
    noResults.style.display = 'none';

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });

    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ product })
        });

        if (!response.ok) {
            throw new Error('Search failed');
        }

        const data = await response.json();
        loadingMessage.style.display = 'none';

        if (data.results.length === 0) {
            noResults.style.display = 'block';
            return;
        }

        // Update header information
        searchTermElement.textContent = data.product;
        resultCountElement.textContent = `Found ${data.count} result${data.count !== 1 ? 's' : ''} across multiple retailers`;

        // Render results
        renderResults(data.results);

        // Calculate and display statistics
        displayStatistics(data.results);

        // Show stats section
        statsSection.style.display = 'block';

    } catch (error) {
        console.error('Error:', error);
        loadingMessage.style.display = 'none';
        noResults.innerHTML = '<p>An error occurred while searching. Please try again.</p>';
        noResults.style.display = 'block';
    }
}

function renderResults(results) {
    resultsContainer.innerHTML = '';

    results.forEach((item, index) => {
        const card = createPriceCard(item, index);
        resultsContainer.appendChild(card);
    });
}

function createPriceCard(item, index) {
    const card = document.createElement('div');
    card.className = 'price-card';
    card.style.animation = `fadeIn 0.3s ease-in ${index * 0.05}s both`;

    const stockStatus = item.inStock ? 'In Stock' : 'Out of Stock';
    const stockClass = item.inStock ? 'in-stock' : 'out-of-stock';

    card.innerHTML = `
        <div class="price-card-left">
            <div class="price-icon">${item.icon || '🔗'}</div>
            <div class="price-info">
                <h3>${item.source}</h3>
                <div class="price-rating">⭐ ${item.rating} • $${parseFloat(item.price).toFixed(2)}</div>
                <span class="stock-status ${stockClass}">${stockStatus}</span>
            </div>
        </div>
        <div class="price-card-right">
            <div class="price-amount">$${parseFloat(item.price).toFixed(2)}</div>
            <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="price-link">
                View Deal
            </a>
        </div>
    `;

    return card;
}

function displayStatistics(results) {
    const prices = results.map(r => parseFloat(r.price));
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);
    const avgPrice = (prices.reduce((a, b) => a + b) / prices.length).toFixed(2);
    const bestDealSource = results.find(r => parseFloat(r.price) === lowestPrice);

    document.getElementById('lowestPrice').textContent = `$${lowestPrice.toFixed(2)}`;
    document.getElementById('avgPrice').textContent = `$${avgPrice}`;
    document.getElementById('priceRange').textContent = `$${lowestPrice.toFixed(2)} - $${highestPrice.toFixed(2)}`;
    document.getElementById('bestDeal').textContent = `${bestDealSource.source} @ $${lowestPrice.toFixed(2)}`;
}

// Allow Enter key in input field
productInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchForm.dispatchEvent(new Event('submit'));
    }
});
