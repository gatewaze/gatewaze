export interface Calendar {
  id: string;
  calendar_id: string;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  is_public: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  calendar_id: string;
  event_id: string;
}
