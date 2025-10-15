/**
 * @fileoverview ProductCard component for displaying product information
 * @author API Documentation Generator
 * @version 1.0.0
 */

import React from 'react';
import { Product } from '../types/product';

/**
 * Props interface for ProductCard component
 * @interface ProductCardProps
 */
interface ProductCardProps {
  /** Product data to display */
  product: Product;
  /** Callback function called when add to cart button is clicked */
  onAddToCart?: (productId: string, quantity: number) => void;
  /** Callback function called when product is clicked */
  onProductClick?: (productId: string) => void;
  /** Whether the product is in loading state */
  loading?: boolean;
  /** Custom CSS class name */
  className?: string;
  /** Whether to show add to cart button */
  showAddToCart?: boolean;
  /** Whether to show product details */
  showDetails?: boolean;
  /** Maximum quantity that can be added to cart */
  maxQuantity?: number;
}

/**
 * ProductCard component for displaying product information in a card format
 * 
 * @param props - Component props
 * @returns JSX element
 * 
 * @example
 * ```tsx
 * const handleAddToCart = (productId: string, quantity: number) => {
 *   addToCart(productId, quantity);
 * };
 * 
 * const handleProductClick = (productId: string) => {
 *   navigateToProduct(productId);
 * };
 * 
 * <ProductCard
 *   product={product}
 *   onAddToCart={handleAddToCart}
 *   onProductClick={handleProductClick}
 *   showAddToCart={true}
 *   showDetails={true}
 * />
 * ```
 */
const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onAddToCart,
  onProductClick,
  loading = false,
  className = '',
  showAddToCart = true,
  showDetails = true,
  maxQuantity = 10
}) => {
  const [quantity, setQuantity] = React.useState(1);
  const [isAddingToCart, setIsAddingToCart] = React.useState(false);

  /**
   * Handle quantity change
   * @param newQuantity - New quantity value
   */
  const handleQuantityChange = (newQuantity: number) => {
    const validQuantity = Math.max(1, Math.min(newQuantity, maxQuantity, product.stock));
    setQuantity(validQuantity);
  };

  /**
   * Handle add to cart button click
   */
  const handleAddToCartClick = async () => {
    if (!onAddToCart || isAddingToCart) return;

    setIsAddingToCart(true);
    try {
      await onAddToCart(product.id, quantity);
    } catch (error) {
      console.error('Failed to add to cart:', error);
    } finally {
      setIsAddingToCart(false);
    }
  };

  /**
   * Handle product card click
   */
  const handleCardClick = () => {
    if (onProductClick) {
      onProductClick(product.id);
    }
  };

  /**
   * Format price for display
   * @param price - Price value
   * @returns Formatted price string
   */
  const formatPrice = (price: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(price);
  };

  /**
   * Get stock status message
   * @returns Stock status message
   */
  const getStockStatus = (): string => {
    if (product.stock === 0) return 'Out of Stock';
    if (product.stock <= 5) return `Only ${product.stock} left`;
    return 'In Stock';
  };

  /**
   * Get stock status class
   * @returns CSS class for stock status
   */
  const getStockStatusClass = (): string => {
    if (product.stock === 0) return 'product-card__stock--out';
    if (product.stock <= 5) return 'product-card__stock--low';
    return 'product-card__stock--available';
  };

  return (
    <div 
      className={`product-card ${className} ${loading ? 'product-card--loading' : ''}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      {/* Product Image */}
      <div className="product-card__image-container">
        {product.images && product.images.length > 0 ? (
          <img
            src={product.images[0]}
            alt={product.name}
            className="product-card__image"
            loading="lazy"
          />
        ) : (
          <div className="product-card__image-placeholder">
            <span>No Image</span>
          </div>
        )}
        
        {/* Stock Status Badge */}
        <div className={`product-card__stock ${getStockStatusClass()}`}>
          {getStockStatus()}
        </div>

        {/* Featured Badge */}
        {product.featured && (
          <div className="product-card__featured">
            Featured
          </div>
        )}
      </div>

      {/* Product Info */}
      <div className="product-card__content">
        <h3 className="product-card__name">{product.name}</h3>
        
        {showDetails && (
          <div className="product-card__details">
            <p className="product-card__description">
              {product.description.length > 100 
                ? `${product.description.substring(0, 100)}...` 
                : product.description
              }
            </p>
            
            <div className="product-card__meta">
              <span className="product-card__brand">{product.brand}</span>
              <span className="product-card__category">{product.category}</span>
            </div>

            {/* Rating */}
            {product.rating && product.rating.average > 0 && (
              <div className="product-card__rating">
                <div className="product-card__stars">
                  {[...Array(5)].map((_, index) => (
                    <span
                      key={index}
                      className={`product-card__star ${
                        index < Math.floor(product.rating.average) 
                          ? 'product-card__star--filled' 
                          : ''
                      }`}
                    >
                      ★
                    </span>
                  ))}
                </div>
                <span className="product-card__rating-text">
                  ({product.rating.count} reviews)
                </span>
              </div>
            )}

            {/* Tags */}
            {product.tags && product.tags.length > 0 && (
              <div className="product-card__tags">
                {product.tags.slice(0, 3).map((tag, index) => (
                  <span key={index} className="product-card__tag">
                    {tag}
                  </span>
                ))}
                {product.tags.length > 3 && (
                  <span className="product-card__tag-more">
                    +{product.tags.length - 3} more
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Price */}
        <div className="product-card__price">
          <span className="product-card__price-current">
            {formatPrice(product.price)}
          </span>
        </div>

        {/* Add to Cart Section */}
        {showAddToCart && product.stock > 0 && (
          <div className="product-card__actions">
            <div className="product-card__quantity">
              <label htmlFor={`quantity-${product.id}`} className="sr-only">
                Quantity
              </label>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleQuantityChange(quantity - 1);
                }}
                className="product-card__quantity-btn"
                disabled={quantity <= 1 || loading}
                aria-label="Decrease quantity"
              >
                -
              </button>
              <input
                type="number"
                id={`quantity-${product.id}`}
                value={quantity}
                onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 1)}
                min="1"
                max={Math.min(maxQuantity, product.stock)}
                className="product-card__quantity-input"
                disabled={loading}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleQuantityChange(quantity + 1);
                }}
                className="product-card__quantity-btn"
                disabled={quantity >= Math.min(maxQuantity, product.stock) || loading}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleAddToCartClick();
              }}
              className="product-card__add-btn"
              disabled={loading || isAddingToCart || product.stock === 0}
            >
              {isAddingToCart ? 'Adding...' : 'Add to Cart'}
            </button>
          </div>
        )}

        {/* Out of Stock Message */}
        {product.stock === 0 && (
          <div className="product-card__out-of-stock">
            <button
              type="button"
              className="product-card__notify-btn"
              disabled={loading}
              onClick={(e) => e.stopPropagation()}
            >
              Notify When Available
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductCard;