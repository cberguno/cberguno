const searchForm = document.getElementById('searchForm');
const productInput = document.getElementById('productInput');
const resultsSection = document.getElementById('resultsSection');
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
        resultCountElement.textContent = `Search "${data.product}" on these retailers:`;

        // Render results
        renderResults(data.results);

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

    card.innerHTML = `
        <div class="price-card-left">
            <div class="price-icon">${item.icon || '🔗'}</div>
            <h3>${item.source}</h3>
        </div>
        <div class="price-card-right">
            <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="price-link">
                View Deal
            </a>
        </div>
    `;

    return card;
}

// Allow Enter key in input field
productInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchForm.dispatchEvent(new Event('submit'));
    }
});
