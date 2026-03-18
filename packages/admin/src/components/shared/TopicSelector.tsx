// @ts-nocheck
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChevronDownIcon, XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Badge } from '@/components/ui-legacy';
import { getAllTopics, searchTopics, type TopicOption } from '@/utils/topicService';

interface TopicSelectorProps {
  selectedTopics: string[];
  onTopicsChange: (topics: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const TopicSelector = ({
  selectedTopics = [],
  onTopicsChange,
  placeholder = "Select topics...",
  disabled = false
}: TopicSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allTopics, setAllTopics] = useState<TopicOption[]>([]);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load topics from DB on mount
  useEffect(() => {
    getAllTopics()
      .then(setAllTopics)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Filter topics based on search query and selected
  const filteredTopics = useMemo(() => {
    const selectedSet = new Set(selectedTopics);
    let topics = allTopics;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      topics = topics.filter(
        (t) => t.label.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
      );
    }

    return topics.filter((topic) => !selectedSet.has(topic.value));
  }, [searchQuery, selectedTopics, allTopics]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handleAddTopic = (topic: string) => {
    if (!selectedTopics.includes(topic)) {
      onTopicsChange([...selectedTopics, topic]);
    }
    setSearchQuery('');
    setIsOpen(false);
  };

  const handleRemoveTopic = (topicToRemove: string) => {
    onTopicsChange(selectedTopics.filter(topic => topic !== topicToRemove));
  };

  const handleToggleDropdown = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
      setSearchQuery('');
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Topics
      </label>

      {/* Selected Topics */}
      {selectedTopics.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedTopics.map((topic) => (
            <Badge
              key={topic}
              variant="soft"
              className="flex items-center gap-1 cursor-pointer group"
            >
              {topic}
              <button
                type="button"
                onClick={() => handleRemoveTopic(topic)}
                className="ml-1 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
                disabled={disabled}
              >
                <XMarkIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Topic Selector */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={handleToggleDropdown}
          disabled={disabled || loading}
          className={`w-full px-3 py-2 text-left border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-900 dark:border-gray-600 dark:text-white ${
            disabled || loading ? 'bg-gray-100 cursor-not-allowed opacity-60' : 'bg-white hover:border-gray-400'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={selectedTopics.length === 0 ? 'text-gray-500' : ''}>
              {loading
                ? 'Loading topics...'
                : selectedTopics.length === 0
                  ? placeholder
                  : `${selectedTopics.length} topic(s) selected`}
            </span>
            <ChevronDownIcon
              className={`size-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          </div>
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute z-[60] w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg dark:bg-gray-800 dark:border-gray-600 max-h-64 overflow-hidden">
            {/* Search Input */}
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search topics..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
                />
              </div>
            </div>

            {/* Topic List */}
            <div className="max-h-48 overflow-y-auto">
              {filteredTopics.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  {searchQuery ? 'No topics found matching your search' : 'No more topics available'}
                </div>
              ) : (
                filteredTopics.map((topic) => (
                  <button
                    key={topic.value}
                    type="button"
                    onClick={() => handleAddTopic(topic.value)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 focus:bg-gray-100 dark:focus:bg-gray-700 focus:outline-none"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-gray-900 dark:text-white">{topic.label}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{topic.category}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
