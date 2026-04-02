import fs from 'fs';
import path from 'path';

/**
 * Service for matching event content against existing topics
 */
export class TopicMatcher {
  constructor(topicsFilePath) {
    this.topicsFilePath = path.resolve(topicsFilePath);
    this.topics = this.loadTopics();
    this.flatTopics = this.flattenTopics();
  }

  /**
   * Load topics from JSON file
   */
  loadTopics() {
    try {
      const topicsData = fs.readFileSync(this.topicsFilePath, 'utf8');
      const topics = JSON.parse(topicsData);
      console.log('🏷️ Topics loaded successfully');
      return topics;
    } catch (error) {
      console.error(`❌ Error loading topics from ${this.topicsFilePath}: ${error.message}`);
      return [];
    }
  }

  /**
   * Flatten nested topics structure into a searchable list
   */
  flattenTopics() {
    const flat = [];

    const flatten = (obj, parentKey = '') => {
      if (Array.isArray(obj)) {
        obj.forEach(topic => {
          flat.push({
            topic: topic.toLowerCase(),
            original: topic,
            category: parentKey
          });
        });
      } else if (typeof obj === 'object') {
        Object.entries(obj).forEach(([key, value]) => {
          const fullKey = parentKey ? `${parentKey}.${key}` : key;
          flatten(value, fullKey);
        });
      }
    };

    // Handle topics.json structure (it's an object, not an array)
    Object.entries(this.topics).forEach(([categoryName, categoryContent]) => {
      flatten(categoryContent, categoryName);
    });

    console.log(`📚 Flattened ${flat.length} topics for matching`);
    return flat;
  }

  /**
   * Match topics against event content
   */
  async matchTopics(content) {
    if (!content) return [];

    const contentLower = content.toLowerCase();
    const matchedTopics = [];
    const seenTopics = new Set();

    // Direct keyword matching
    this.flatTopics.forEach(topicInfo => {
      const { topic, original, category } = topicInfo;

      // Skip if already matched
      if (seenTopics.has(original)) return;

      // Exact match
      if (contentLower.includes(topic)) {
        matchedTopics.push({
          topic: original,
          category: category,
          matchType: 'exact',
          confidence: 1.0
        });
        seenTopics.add(original);
        return;
      }

      // Word boundary match (more precise)
      const wordBoundaryRegex = new RegExp(`\\b${this.escapeRegex(topic)}\\b`, 'i');
      if (wordBoundaryRegex.test(content)) {
        matchedTopics.push({
          topic: original,
          category: category,
          matchType: 'word_boundary',
          confidence: 0.9
        });
        seenTopics.add(original);
        return;
      }

      // Partial match for longer topics
      if (topic.length > 8 && this.partialMatch(contentLower, topic)) {
        matchedTopics.push({
          topic: original,
          category: category,
          matchType: 'partial',
          confidence: 0.7
        });
        seenTopics.add(original);
      }
    });

    // Framework/library specific matching
    const frameworkMatches = this.matchFrameworks(contentLower);
    frameworkMatches.forEach(match => {
      if (!seenTopics.has(match.topic)) {
        matchedTopics.push(match);
        seenTopics.add(match.topic);
      }
    });

    // Programming language detection
    const languageMatches = this.matchProgrammingLanguages(contentLower);
    languageMatches.forEach(match => {
      if (!seenTopics.has(match.topic)) {
        matchedTopics.push(match);
        seenTopics.add(match.topic);
      }
    });

    // Sort by confidence and return topic names only
    return matchedTopics
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5) // Limit to top 5 matches
      .map(match => match.topic);
  }

  /**
   * Framework-specific matching logic
   */
  matchFrameworks(contentLower) {
    const matches = [];

    const frameworkPatterns = {
      'React': ['react.js', 'reactjs', 'react native'],
      'Angular': ['angular.js', 'angularjs', 'angular2', 'angular 2'],
      'Vue': ['vue.js', 'vuejs', 'vue 3'],
      'Node.js': ['node.js', 'nodejs', 'node js'],
      'Express.js': ['express.js', 'expressjs', 'express js'],
      'Django': ['django rest', 'django web'],
      'Laravel': ['laravel framework', 'laravel php'],
      'Spring Boot': ['spring boot', 'springboot', 'spring framework'],
      'Flutter': ['flutter dev', 'flutter mobile'],
      'React Native': ['react native', 'react-native', 'rn mobile']
    };

    Object.entries(frameworkPatterns).forEach(([framework, patterns]) => {
      patterns.forEach(pattern => {
        if (contentLower.includes(pattern)) {
          matches.push({
            topic: framework,
            category: 'Frameworks & Libraries',
            matchType: 'framework_pattern',
            confidence: 0.8
          });
        }
      });
    });

    return matches;
  }

  /**
   * Programming language specific matching
   */
  matchProgrammingLanguages(contentLower) {
    const matches = [];

    const languagePatterns = {
      'JavaScript': ['javascript', 'js dev', 'ecmascript', 'es6', 'es2015'],
      'TypeScript': ['typescript', 'ts dev', '.ts'],
      'Python': ['python dev', 'python programming', 'django', 'flask'],
      'Java': ['java dev', 'java programming', 'jvm', 'spring'],
      'C#': ['c# dev', 'csharp', 'dotnet', '.net'],
      'PHP': ['php dev', 'php programming', 'laravel', 'symfony'],
      'Ruby': ['ruby dev', 'ruby programming', 'rails', 'ruby on rails'],
      'Go': ['golang', 'go programming', 'go dev'],
      'Rust': ['rust programming', 'rust dev', 'rust lang'],
      'Kotlin': ['kotlin dev', 'kotlin programming', 'android kotlin'],
      'Swift': ['swift dev', 'swift programming', 'ios swift'],
      'Scala': ['scala dev', 'scala programming'],
      'Elixir': ['elixir dev', 'elixir programming', 'phoenix']
    };

    Object.entries(languagePatterns).forEach(([language, patterns]) => {
      patterns.forEach(pattern => {
        if (contentLower.includes(pattern)) {
          matches.push({
            topic: language,
            category: 'Programming Languages',
            matchType: 'language_pattern',
            confidence: 0.85
          });
        }
      });
    });

    return matches;
  }

  /**
   * Check for partial matches (useful for compound terms)
   */
  partialMatch(content, topic) {
    // Split topic into words and check if most words are present
    const topicWords = topic.split(' ').filter(word => word.length > 2);
    if (topicWords.length === 0) return false;

    const matchingWords = topicWords.filter(word =>
      content.includes(word.toLowerCase())
    );

    // Require at least 70% of words to match
    return (matchingWords.length / topicWords.length) >= 0.7;
  }

  /**
   * Escape special regex characters
   */
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get topic statistics
   */
  getStats() {
    return {
      totalTopics: this.flatTopics.length,
      categories: [...new Set(this.flatTopics.map(t => t.category))].length,
      topicsByCategory: this.groupByCategory()
    };
  }

  /**
   * Group topics by category for analysis
   */
  groupByCategory() {
    const grouped = {};
    this.flatTopics.forEach(topic => {
      if (!grouped[topic.category]) {
        grouped[topic.category] = [];
      }
      grouped[topic.category].push(topic.original);
    });
    return grouped;
  }

  /**
   * Add new topics to the topics file
   */
  addTopics(newTopics) {
    // Implementation for adding new topics
    // This would modify the topics.json file
    console.log('Adding new topics:', newTopics);
    // TODO: Implement topic addition logic
  }

  /**
   * Suggest new topics based on unmatched content
   */
  suggestTopics(unmatchedContent) {
    // Implementation for suggesting new topics based on content analysis
    // This could use NLP techniques to identify potential new topics
    console.log('Analyzing content for topic suggestions:', unmatchedContent.substring(0, 100));
    // TODO: Implement topic suggestion logic
  }
}