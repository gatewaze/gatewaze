// @ts-nocheck
/**
 * Template Variable System
 *
 * Supports Customer.io style template variables with filters and defaults.
 * Format: {{scope.field | filter:"value"}}
 *
 * Examples:
 *   {{customer.first_name | default:"there"}}
 *   {{sponsor.name}}
 *   {{event.slug}}
 */

// Types for template variable definitions
export interface TemplateVariableDefinition {
  scope: string;
  field: string;
  label: string;
  description?: string;
  example?: string;
}

export interface TemplateVariableScope {
  name: string;
  label: string;
  description?: string;
  variables: Omit<TemplateVariableDefinition, 'scope'>[];
}

// Available variable scopes and their fields
export const templateVariableScopes: TemplateVariableScope[] = [
  {
    name: 'customer',
    label: 'Customer/Recipient',
    description: 'Variables for the email recipient',
    variables: [
      { field: 'first_name', label: 'First Name', description: 'Recipient first name', example: 'John' },
      { field: 'last_name', label: 'Last Name', description: 'Recipient last name', example: 'Doe' },
      { field: 'full_name', label: 'Full Name', description: 'Recipient full name', example: 'John Doe' },
      { field: 'email', label: 'Email', description: 'Recipient email address', example: 'john@example.com' },
    ],
  },
  {
    name: 'speaker',
    label: 'Speaker',
    description: 'Variables for speaker information (for speaker emails)',
    variables: [
      { field: 'first_name', label: 'First Name', description: 'Speaker first name', example: 'Jane' },
      { field: 'last_name', label: 'Last Name', description: 'Speaker last name', example: 'Smith' },
      { field: 'full_name', label: 'Full Name', description: 'Speaker full name', example: 'Jane Smith' },
      { field: 'email', label: 'Email', description: 'Speaker email address', example: 'jane@example.com' },
      { field: 'talk_title', label: 'Talk Title', description: 'Title of the speaker\'s talk', example: 'Building AI-Powered Applications' },
      { field: 'talk_synopsis', label: 'Talk Synopsis', description: 'Synopsis of the speaker\'s talk', example: 'In this talk, we will explore...' },
      { field: 'company', label: 'Company', description: 'Speaker\'s company name', example: 'Tech Corp' },
      { field: 'job_title', label: 'Job Title', description: 'Speaker\'s job title', example: 'Senior Engineer' },
      { field: 'confirmation_link', label: 'Confirmation Link', description: 'Link for speaker to confirm attendance. Use {{speaker.confirmation_link}} for current event, or {{speaker.confirmation_link:EVENT_ID}} to confirm for a different event (e.g., offering rejected speakers a slot at another event)', example: 'https://app.gatewaze.com/speaker-confirm?token=abc123' },
      { field: 'edit_link', label: 'Edit Link', description: 'Relative link to the speaker dashboard where confirmed speakers can view their status, upload presentations, and edit their talk. Prepend your portal domain when using in emails.', example: '/events/abc123/talks/success/xyz789' },
    ],
  },
  {
    name: 'sponsor',
    label: 'Sponsor',
    description: 'Variables for sponsor information',
    variables: [
      { field: 'name', label: 'Sponsor Name', description: 'Sponsor company name', example: 'Acme Corp' },
      { field: 'slug', label: 'Sponsor Slug', description: 'URL-friendly sponsor identifier', example: 'acme-corp' },
    ],
  },
  {
    name: 'event',
    label: 'Event',
    description: 'Variables for event information',
    variables: [
      { field: 'name', label: 'Event Name', description: 'Event title', example: 'AI Summit 2025' },
      { field: 'slug', label: 'Event Slug', description: 'URL-friendly event identifier', example: 'ai-summit-2025' },
      { field: 'id', label: 'Event ID', description: 'Unique event identifier', example: 'abc123' },
      { field: 'city', label: 'City', description: 'Event city', example: 'San Francisco' },
      { field: 'country', label: 'Country', description: 'Event country code', example: 'US' },
      { field: 'event_start', label: 'Start Date', description: 'Event start date', example: 'January 15, 2025' },
      { field: 'event_end', label: 'End Date', description: 'Event end date', example: 'January 17, 2025' },
    ],
  },
];

// Get all available variables as a flat list
export function getAllVariables(): TemplateVariableDefinition[] {
  const variables: TemplateVariableDefinition[] = [];
  for (const scope of templateVariableScopes) {
    for (const variable of scope.variables) {
      variables.push({
        scope: scope.name,
        field: variable.field,
        label: variable.label,
        description: variable.description,
        example: variable.example,
      });
    }
  }
  return variables;
}

// Get variables for a specific scope
export function getVariablesForScope(scopeName: string): TemplateVariableDefinition[] {
  const scope = templateVariableScopes.find(s => s.name === scopeName);
  if (!scope) return [];
  return scope.variables.map(v => ({
    scope: scopeName,
    field: v.field,
    label: v.label,
    description: v.description,
    example: v.example,
  }));
}

// Generate the template variable string
export function formatVariable(scope: string, field: string, defaultValue?: string): string {
  if (defaultValue) {
    return `{{${scope}.${field} | default:"${defaultValue}"}}`;
  }
  return `{{${scope}.${field}}}`;
}

// Parse a template variable string
interface ParsedVariable {
  scope: string;
  field: string;
  param?: string; // Optional parameter for the field (e.g., {{speaker.confirmation_link:EVENT_ID}})
  filters: Array<{ name: string; value?: string }>;
  raw: string;
}

export function parseVariable(variableStr: string): ParsedVariable | null {
  // Match {{scope.field:param | filter:"value" | filter2}} where :param is optional
  // Examples:
  //   {{speaker.first_name}}
  //   {{speaker.confirmation_link:abc123}}
  //   {{customer.name | default:"Guest"}}
  //   {{speaker.confirmation_link:xyz789 | default:"#"}}
  const match = variableStr.match(/^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)(?::([a-zA-Z0-9_-]+))?\s*((?:\|\s*[a-zA-Z_][a-zA-Z0-9_]*(?::"[^"]*")?\s*)*)\}\}$/);

  if (!match) return null;

  const [raw, scope, field, param, filtersStr] = match;
  const filters: Array<{ name: string; value?: string }> = [];

  if (filtersStr) {
    // Parse filters like: | default:"value" | uppercase
    const filterMatches = filtersStr.matchAll(/\|\s*([a-zA-Z_][a-zA-Z0-9_]*)(?::"([^"]*)")?/g);
    for (const fm of filterMatches) {
      filters.push({
        name: fm[1],
        value: fm[2],
      });
    }
  }

  return { scope, field, param, filters, raw };
}

// Find all template variables in a string
export function findAllVariables(text: string): ParsedVariable[] {
  const variables: ParsedVariable[] = [];
  const regex = /\{\{[^}]+\}\}/g;
  const matches = text.matchAll(regex);

  for (const match of matches) {
    const parsed = parseVariable(match[0]);
    if (parsed) {
      variables.push(parsed);
    }
  }

  return variables;
}

// Apply filters to a value
function applyFilters(value: string | undefined | null, filters: Array<{ name: string; value?: string }>): string {
  let result = value ?? '';

  for (const filter of filters) {
    switch (filter.name) {
      case 'default':
        if (!result || result.trim() === '') {
          result = filter.value ?? '';
        }
        break;
      case 'uppercase':
        result = result.toUpperCase();
        break;
      case 'lowercase':
        result = result.toLowerCase();
        break;
      case 'capitalize':
        result = result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
        break;
      case 'slug':
        result = generateSlug(result);
        break;
      // Add more filters as needed
    }
  }

  return result;
}

// Generate a URL-friendly slug from a string
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars (except spaces and hyphens)
    .replace(/\s+/g, '-')     // Replace spaces with hyphens
    .replace(/-+/g, '-')      // Replace multiple hyphens with single
    .replace(/^-+|-+$/g, ''); // Trim hyphens from start and end
}

// Context data types
export interface CustomerContext {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
}

export interface SpeakerContext {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  talk_title?: string;
  talk_synopsis?: string;
  company?: string;
  job_title?: string;
  confirmation_link?: string;
  edit_link?: string;
  // Internal fields for generating parameterized confirmation links
  _confirmation_token?: string;
  _confirmation_base_url?: string;
}

export interface SponsorContext {
  name?: string;
  slug?: string;
}

export interface EventContext {
  name?: string;
  slug?: string;
  id?: string;
  city?: string;
  country?: string;
  event_start?: string;
  event_end?: string;
}

export interface TemplateContext {
  customer?: CustomerContext;
  speaker?: SpeakerContext;
  sponsor?: SponsorContext;
  event?: EventContext;
}

// Replace all template variables in a string with their values
export function replaceVariables(template: string, context: TemplateContext): string {
  const variables = findAllVariables(template);
  let result = template;

  for (const variable of variables) {
    const scopeData = context[variable.scope as keyof TemplateContext];
    let value: string | undefined;

    // Special handling for parameterized confirmation_link
    // {{speaker.confirmation_link}} - use default link for current event
    // {{speaker.confirmation_link:EVENT_ID}} - generate link for specified event
    if (variable.scope === 'speaker' && variable.field === 'confirmation_link' && variable.param && scopeData) {
      const speakerData = scopeData as SpeakerContext;
      if (speakerData._confirmation_token && speakerData._confirmation_base_url) {
        // Generate confirmation link for the specified event ID
        value = `${speakerData._confirmation_base_url}/functions/v1/speaker-confirm?token=${speakerData._confirmation_token}&event_id=${variable.param}`;
      }
    } else {
      value = scopeData ? (scopeData as Record<string, string | undefined>)[variable.field] : undefined;
    }

    const replacedValue = applyFilters(value, variable.filters);
    result = result.replace(variable.raw, replacedValue);
  }

  return result;
}

// Build context from raw data
export interface BuildContextOptions {
  customer?: {
    first_name?: string;
    last_name?: string;
    full_name?: string;
    email?: string;
  };
  speaker?: {
    first_name?: string;
    last_name?: string;
    full_name?: string;
    email?: string;
    talk_title?: string;
    talk_synopsis?: string;
    company?: string;
    job_title?: string;
    confirmation_link?: string;
    edit_link?: string;
    // For generating parameterized confirmation links
    _confirmation_token?: string;
    _confirmation_base_url?: string;
  };
  sponsor?: {
    name?: string;
    slug?: string;
  };
  event?: {
    event_title?: string;
    event_id?: string; // 6-character event identifier
    event_city?: string;
    event_country_code?: string;
    event_start?: string | Date;
    event_end?: string | Date;
  };
}

export function buildContext(options: BuildContextOptions): TemplateContext {
  const context: TemplateContext = {};

  if (options.customer) {
    context.customer = {
      first_name: options.customer.first_name,
      last_name: options.customer.last_name,
      full_name: options.customer.full_name ||
        [options.customer.first_name, options.customer.last_name].filter(Boolean).join(' '),
      email: options.customer.email,
    };
  }

  if (options.speaker) {
    context.speaker = {
      first_name: options.speaker.first_name,
      last_name: options.speaker.last_name,
      full_name: options.speaker.full_name ||
        [options.speaker.first_name, options.speaker.last_name].filter(Boolean).join(' '),
      email: options.speaker.email,
      talk_title: options.speaker.talk_title,
      talk_synopsis: options.speaker.talk_synopsis,
      company: options.speaker.company,
      job_title: options.speaker.job_title,
      confirmation_link: options.speaker.confirmation_link,
      edit_link: options.speaker.edit_link,
      // Internal fields for parameterized confirmation links
      _confirmation_token: options.speaker._confirmation_token,
      _confirmation_base_url: options.speaker._confirmation_base_url,
    };
  }

  if (options.sponsor) {
    context.sponsor = {
      name: options.sponsor.name,
      slug: options.sponsor.slug,
    };
  }

  if (options.event) {
    const eventName = options.event.event_title || '';
    context.event = {
      name: eventName,
      slug: generateSlug(eventName),
      id: options.event.event_id, // Uses 6-character event_id
      city: options.event.event_city,
      country: options.event.event_country_code,
      event_start: options.event.event_start
        ? formatDate(options.event.event_start)
        : undefined,
      event_end: options.event.event_end
        ? formatDate(options.event.event_end)
        : undefined,
    };
  }

  return context;
}

// Format a date for display
function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Validate that all required variables have values in the context
export interface ValidationResult {
  isValid: boolean;
  missingVariables: ParsedVariable[];
  warnings: string[];
}

export function validateTemplate(template: string, context: TemplateContext): ValidationResult {
  const variables = findAllVariables(template);
  const missingVariables: ParsedVariable[] = [];
  const warnings: string[] = [];

  for (const variable of variables) {
    const scopeData = context[variable.scope as keyof TemplateContext];

    if (!scopeData) {
      // Check if there's a default filter
      const hasDefault = variable.filters.some(f => f.name === 'default');
      if (!hasDefault) {
        missingVariables.push(variable);
      } else {
        warnings.push(`Variable {{${variable.scope}.${variable.field}}} has no data but will use default value`);
      }
      continue;
    }

    const value = (scopeData as Record<string, string | undefined>)[variable.field];
    if (!value || value.trim() === '') {
      const hasDefault = variable.filters.some(f => f.name === 'default');
      if (!hasDefault) {
        missingVariables.push(variable);
      } else {
        warnings.push(`Variable {{${variable.scope}.${variable.field}}} is empty but will use default value`);
      }
    }
  }

  return {
    isValid: missingVariables.length === 0,
    missingVariables,
    warnings,
  };
}
