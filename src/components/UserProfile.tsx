/**
 * @fileoverview UserProfile component for displaying and editing user information
 * @author API Documentation Generator
 * @version 1.0.0
 */

import React, { useState, useEffect } from 'react';
import { User, UpdateUserRequest } from '../types/user';

/**
 * Props interface for UserProfile component
 * @interface UserProfileProps
 */
interface UserProfileProps {
  /** User data to display and edit */
  user: User;
  /** Callback function called when user data is updated */
  onUpdate: (updatedUser: UpdateUserRequest) => Promise<void>;
  /** Whether the component is in loading state */
  loading?: boolean;
  /** Custom CSS class name */
  className?: string;
  /** Whether the profile is editable */
  editable?: boolean;
}

/**
 * UserProfile component for displaying and editing user profile information
 * 
 * @param props - Component props
 * @returns JSX element
 * 
 * @example
 * ```tsx
 * const handleUpdate = async (updatedUser: UpdateUserRequest) => {
 *   await updateUserProfile(updatedUser);
 * };
 * 
 * <UserProfile
 *   user={currentUser}
 *   onUpdate={handleUpdate}
 *   editable={true}
 *   loading={isLoading}
 * />
 * ```
 */
const UserProfile: React.FC<UserProfileProps> = ({
  user,
  onUpdate,
  loading = false,
  className = '',
  editable = true
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<UpdateUserRequest>({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * Reset form data when user changes
   */
  useEffect(() => {
    setFormData({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email
    });
  }, [user]);

  /**
   * Handle input change
   * @param field - Field name
   * @param value - New value
   */
  const handleInputChange = (field: keyof UpdateUserRequest, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ''
      }));
    }
  };

  /**
   * Validate form data
   * @returns true if valid, false otherwise
   */
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.firstName?.trim()) {
      newErrors.firstName = 'First name is required';
    } else if (formData.firstName.length < 2) {
      newErrors.firstName = 'First name must be at least 2 characters';
    }

    if (!formData.lastName?.trim()) {
      newErrors.lastName = 'Last name is required';
    } else if (formData.lastName.length < 2) {
      newErrors.lastName = 'Last name must be at least 2 characters';
    }

    if (!formData.email?.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      await onUpdate(formData);
      setIsEditing(false);
      setErrors({});
    } catch (error) {
      console.error('Failed to update profile:', error);
    }
  };

  /**
   * Handle cancel editing
   */
  const handleCancel = () => {
    setFormData({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email
    });
    setErrors({});
    setIsEditing(false);
  };

  return (
    <div className={`user-profile ${className}`}>
      <div className="user-profile__header">
        <h2>User Profile</h2>
        {editable && !isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="btn btn--primary"
            disabled={loading}
          >
            Edit Profile
          </button>
        )}
      </div>

      {isEditing ? (
        <form onSubmit={handleSubmit} className="user-profile__form">
          <div className="form-group">
            <label htmlFor="firstName" className="form-label">
              First Name *
            </label>
            <input
              type="text"
              id="firstName"
              value={formData.firstName || ''}
              onChange={(e) => handleInputChange('firstName', e.target.value)}
              className={`form-input ${errors.firstName ? 'form-input--error' : ''}`}
              disabled={loading}
            />
            {errors.firstName && (
              <span className="form-error">{errors.firstName}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="lastName" className="form-label">
              Last Name *
            </label>
            <input
              type="text"
              id="lastName"
              value={formData.lastName || ''}
              onChange={(e) => handleInputChange('lastName', e.target.value)}
              className={`form-input ${errors.lastName ? 'form-input--error' : ''}`}
              disabled={loading}
            />
            {errors.lastName && (
              <span className="form-error">{errors.lastName}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="email" className="form-label">
              Email Address *
            </label>
            <input
              type="email"
              id="email"
              value={formData.email || ''}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className={`form-input ${errors.email ? 'form-input--error' : ''}`}
              disabled={loading}
            />
            {errors.email && (
              <span className="form-error">{errors.email}</span>
            )}
          </div>

          <div className="form-actions">
            <button
              type="button"
              onClick={handleCancel}
              className="btn btn--secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      ) : (
        <div className="user-profile__display">
          <div className="user-profile__field">
            <label className="user-profile__label">Name:</label>
            <span className="user-profile__value">
              {user.firstName} {user.lastName}
            </span>
          </div>
          <div className="user-profile__field">
            <label className="user-profile__label">Email:</label>
            <span className="user-profile__value">{user.email}</span>
          </div>
          <div className="user-profile__field">
            <label className="user-profile__label">Member Since:</label>
            <span className="user-profile__value">
              {new Date(user.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserProfile;