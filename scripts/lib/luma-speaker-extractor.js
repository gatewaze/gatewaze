/**
 * Luma Speaker Extractor
 *
 * Uses Claude API to extract speaker and talk information from
 * event description HTML content.
 */

import Anthropic from '@anthropic-ai/sdk';

// Lazy initialization of Anthropic client
let anthropic = null;

function getAnthropicClient() {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

/**
 * @typedef {Object} ExtractedSpeaker
 * @property {string} name - Full name
 * @property {string} [firstName] - First name
 * @property {string} [lastName] - Last name
 * @property {string} [company] - Company/organization
 * @property {string} [jobTitle] - Job title or role
 * @property {string} [linkedinUrl] - LinkedIn profile URL
 * @property {string} [bio] - Speaker bio
 * @property {string} [photoUrl] - Speaker photo URL (from lumacdn)
 * @property {Array<ExtractedTalk>} talks - Associated talks
 */

/**
 * @typedef {Object} ExtractedTalk
 * @property {string} title - Talk title
 * @property {string} [synopsis] - Talk description/synopsis
 * @property {number} [durationMinutes] - Duration in minutes
 */

/**
 * @typedef {Object} ExtractionResult
 * @property {boolean} success
 * @property {Array<ExtractedSpeaker>} [speakers]
 * @property {string} [error]
 * @property {Object} [usage] - Token usage info
 */

const EXTRACTION_PROMPT = `You are an expert at extracting speaker and talk information from event descriptions.

Analyze the following event description HTML and extract all speakers and their associated talks.

For each speaker, extract:
- name: Full name of the speaker
- firstName: First name (if determinable)
- lastName: Last name (if determinable)
- company: Company or organization they work for
- jobTitle: Their job title or role
- linkedinUrl: LinkedIn profile URL if mentioned (look for linkedin.com links)
- bio: Their biographical information (if provided separately from the talk description)
- photoUrl: URL of their photo if embedded in the content (look for img tags or image URLs)
- talks: Array of talks they are presenting

For each talk, extract:
- title: The title of the talk
- synopsis: Description or synopsis of what they will present
- durationMinutes: Duration in minutes if mentioned

Important guidelines:
1. Look for patterns like "🎤 Speaker Name" or "presented by" or speaker introductions
2. Look for talk titles in bold, italics, or preceded by time slots (like "6:30 PM - Talk Title")
3. Speaker bios often come after the talk description or as a separate paragraph about the person
4. If a speaker has multiple talks, include all of them in their talks array
5. Don't include event hosts/organizers unless they are also presenting talks
6. If you can't determine first/last name split, leave those fields null but include the full name
7. Extract LinkedIn URLs from hyperlinks in the content
8. Photo URLs are typically from images.lumacdn.com

Return ONLY valid JSON in this exact format, with no additional text:
{
  "speakers": [
    {
      "name": "Full Name",
      "firstName": "First",
      "lastName": "Name",
      "company": "Company Name",
      "jobTitle": "Job Title",
      "linkedinUrl": "https://linkedin.com/in/...",
      "bio": "Bio text...",
      "photoUrl": "https://images.lumacdn.com/...",
      "talks": [
        {
          "title": "Talk Title",
          "synopsis": "Talk description...",
          "durationMinutes": 30
        }
      ]
    }
  ]
}

If no speakers are found, return: {"speakers": []}`;

/**
 * Extract speakers and talks from event description using Claude API
 * @param {string} htmlContent - The HTML content of the event description
 * @param {string} eventTitle - The title of the event (for context)
 * @returns {Promise<ExtractionResult>}
 */
export async function extractSpeakers(htmlContent, eventTitle) {
  if (!htmlContent || htmlContent.trim().length === 0) {
    return {
      success: true,
      speakers: [],
    };
  }

  try {
    const client = getAnthropicClient();

    console.log(`🤖 Extracting speakers for: ${eventTitle}`);

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT}

Event Title: ${eventTitle}

Event Description HTML:
${htmlContent}`,
        },
      ],
    });

    // Extract the text content from the response
    const responseText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Parse the JSON response
    let parsed;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.error('Response was:', responseText.substring(0, 500));
      return {
        success: false,
        error: `Failed to parse AI response: ${parseError.message}`,
      };
    }

    // Validate the response structure
    if (!Array.isArray(parsed.speakers)) {
      return {
        success: false,
        error: 'Invalid response structure: missing speakers array',
      };
    }

    // Clean and validate each speaker
    const speakers = parsed.speakers.map((speaker) => ({
      name: speaker.name || '',
      firstName: speaker.firstName || null,
      lastName: speaker.lastName || null,
      company: speaker.company || null,
      jobTitle: speaker.jobTitle || null,
      linkedinUrl: speaker.linkedinUrl || null,
      bio: speaker.bio || null,
      photoUrl: speaker.photoUrl || null,
      talks: Array.isArray(speaker.talks)
        ? speaker.talks.map((talk) => ({
            title: talk.title || '',
            synopsis: talk.synopsis || null,
            durationMinutes: talk.durationMinutes || null,
          }))
        : [],
    }));

    // Filter out speakers without names
    const validSpeakers = speakers.filter((s) => s.name && s.name.trim().length > 0);

    console.log(`✅ Extracted ${validSpeakers.length} speakers`);

    return {
      success: true,
      speakers: validSpeakers,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  } catch (error) {
    console.error('Speaker extraction error:', error);

    // Handle specific API errors
    if (error.status === 401) {
      return {
        success: false,
        error: 'Invalid ANTHROPIC_API_KEY',
      };
    }

    if (error.status === 429) {
      return {
        success: false,
        error: 'Rate limited by Anthropic API. Try again later.',
      };
    }

    return {
      success: false,
      error: error.message || 'Unknown error during speaker extraction',
    };
  }
}

/**
 * Split a full name into first and last name components
 * @param {string} fullName
 * @returns {{firstName: string|null, lastName: string|null}}
 */
export function splitName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return { firstName: null, lastName: null };
  }

  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) {
    return { firstName: null, lastName: null };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  // First part is first name, rest is last name
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export default {
  extractSpeakers,
  splitName,
};
