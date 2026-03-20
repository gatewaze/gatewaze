/**
 * Unauthorized access page
 * Shown when user doesn't have permission to access a feature
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldX, Home, ArrowLeft } from 'lucide-react';
import { Button, Card } from '@/components/ui';

export default function Unauthorized() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <Card className="p-8">
          <div className="flex justify-center mb-6">
            <div className="rounded-full bg-red-100 p-4">
              <ShieldX className="h-12 w-12 text-red-600" />
            </div>
          </div>

          <h1 className="text-2xl font-semibold text-[var(--gray-12)] mb-2">
            Access Denied
          </h1>

          <p className="text-gray-600 mb-6">
            You don't have permission to access this feature. Please contact your administrator if you believe this is an error.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </Button>

            <Button
              variant="solid"
              onClick={() => navigate('/dashboard')}
            >
              <Home className="h-4 w-4" />
              Go to Dashboard
            </Button>
          </div>
        </Card>

        <div className="mt-6">
          <p className="text-sm text-gray-500">
            Need access?{' '}
            <a
              href="mailto:support@example.com"
              className="text-primary hover:text-primary-dark font-medium"
            >
              Contact Support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
