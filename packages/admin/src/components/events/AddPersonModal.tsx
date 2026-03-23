import { useState } from 'react';
import { UserPlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Button, Modal, Input } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { BulkRegistrationService } from '@/utils/bulkRegistrationService';
import { toast } from 'sonner';

interface AddPersonModalProps {
  eventId: string;
  onComplete?: () => void;
}

interface PersonProfile {
  id: string;
  email: string;
  cio_id: string;
  attributes: {
    first_name?: string;
    last_name?: string;
    company?: string;
    job_title?: string;
  };
}

export const AddPersonModal = ({ eventId, onComplete }: AddPersonModalProps) => {
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [people, setPeople] = useState<PersonProfile[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonProfile | null>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast.error('Please enter an email address to search');
      return;
    }

    setSearching(true);
    setPeople([]);
    setSelectedPerson(null);

    try {
      const { data, error } = await supabase
        .from('people')
        .select('id, email, cio_id, attributes')
        .ilike('email', `%${searchQuery.trim()}%`)
        .limit(10);

      if (error) {
        console.error('Error searching people:', error);
        toast.error('Failed to search for users');
        return;
      }

      if (!data || data.length === 0) {
        toast.info('No users found with that email');
      } else {
        setPeople(data);
      }
    } catch (error) {
      console.error('Error searching people:', error);
      toast.error('Failed to search for users');
    } finally {
      setSearching(false);
    }
  };

  const handleRegister = async () => {
    if (!selectedPerson) {
      toast.error('Please select a user to register');
      return;
    }

    setRegistering(true);

    try {
      // Get or create member profile
      const peopleProfile = await BulkRegistrationService.getOrCreatePeopleProfile(selectedPerson.id);

      if (!peopleProfile) {
        toast.error('Failed to create member profile');
        return;
      }

      // Register for event (person_id is the people.id, peopleProfile.id is the profile UUID)
      const success = await BulkRegistrationService.registerForEvent(eventId, selectedPerson.id, peopleProfile.id);

      if (success) {
        toast.success(`Successfully registered ${selectedPerson.email}`);
        handleClose();
        if (onComplete) {
          onComplete();
        }
      } else {
        toast.error('Failed to register user for event');
      }
    } catch (error) {
      console.error('Error registering user:', error);
      toast.error('Failed to register user for event');
    } finally {
      setRegistering(false);
    }
  };

  const handleClose = () => {
    if (!registering) {
      setShowModal(false);
      setSearchQuery('');
      setPeople([]);
      setSelectedPerson(null);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !searching) {
      handleSearch();
    }
  };

  return (
    <>
      <Button
        variant="primary"
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2"
      >
        <UserPlusIcon className="w-4 h-4" />
        Add Person
      </Button>

      <Modal
        isOpen={showModal}
        onClose={handleClose}
        title="Add Person to Event"
        size="md"
        footer={
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={registering}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRegister}
              disabled={!selectedPerson || registering}
            >
              {registering ? 'Registering...' : 'Register User'}
            </Button>
          </div>
        }
      >
        <div className="space-y-6">
          {/* Search Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Search by Email
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="email"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Enter email address..."
                  disabled={searching || registering}
                />
              </div>
              <Button
                variant="secondary"
                onClick={handleSearch}
                disabled={searching || registering || !searchQuery.trim()}
                className="flex items-center gap-2"
              >
                <MagnifyingGlassIcon className="w-4 h-4" />
                {searching ? 'Searching...' : 'Search'}
              </Button>
            </div>
          </div>

          {/* Results */}
          {people.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Select User ({people.length} found)
              </label>
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700 max-h-80 overflow-y-auto">
                {people.map((customer) => {
                  const firstName = customer.attributes?.first_name || '';
                  const lastName = customer.attributes?.last_name || '';
                  const fullName = firstName && lastName
                    ? `${firstName} ${lastName}`
                    : firstName || lastName || 'No name';
                  const company = customer.attributes?.company || 'No company';
                  const jobTitle = customer.attributes?.job_title || 'No title';

                  return (
                    <button
                      key={customer.id}
                      onClick={() => setSelectedPerson(customer)}
                      disabled={registering}
                      className={`w-full text-left p-4 transition-colors ${
                        selectedPerson?.id === customer.id
                          ? 'bg-primary-50 dark:bg-primary-900/20 border-l-4 border-primary-600'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      } ${registering ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-gray-900 dark:text-white truncate">
                              {fullName}
                            </p>
                            {selectedPerson?.id === customer.id && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-200">
                                Selected
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                            {customer.email}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-gray-500">
                            <span>{jobTitle}</span>
                            <span>•</span>
                            <span>{company}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* No Results Message */}
          {!searching && people.length === 0 && searchQuery && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <MagnifyingGlassIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No users found matching "{searchQuery}"</p>
              <p className="text-xs mt-1">Try searching with a different email address</p>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};
