import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function generateEventId(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  let id = '';
  const letterCount = 3 + Math.floor(Math.random() * 2); // 3 or 4 letters
  for (let i = 0; i < letterCount; i++) {
    id += letters[Math.floor(Math.random() * letters.length)];
  }
  const remainingChars = 6 - letterCount;
  for (let i = 0; i < remainingChars; i++) {
    id += numbers[Math.floor(Math.random() * numbers.length)];
  }
  return id.split('').sort(() => Math.random() - 0.5).join('');
}

const eventSchema = z.object({
  event_title: z.string().min(1, 'Title is required').max(200, 'Title must be under 200 characters'),
  event_description: z.string().optional(),
  event_start: z.string().min(1, 'Start date is required'),
  event_end: z.string().optional(),
  event_location: z.string().optional(),
  event_type: z.string().optional(),
  status: z.enum(['incomplete', 'published']).default('incomplete'),
});

type EventFormValues = z.infer<typeof eventSchema>;

export default function EventCreatePage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: {
      event_title: '',
      event_description: '',
      event_start: '',
      event_end: '',
      event_location: '',
      event_type: '',
      status: 'incomplete',
    },
  });

  const status = watch('status');

  async function onSubmit(data: EventFormValues) {
    try {
      setSubmitting(true);
      const supabase = getSupabase();

      const insertData: Record<string, unknown> = {
        event_id: generateEventId(),
        event_title: data.event_title,
        event_description: data.event_description || null,
        event_start: new Date(data.event_start).toISOString(),
        event_end: data.event_end ? new Date(data.event_end).toISOString() : null,
        event_location: data.event_location || null,
        event_type: data.event_type || null,
        status: data.status,
      };

      const { data: newEvent, error } = await supabase
        .from('events')
        .insert(insertData)
        .select('id')
        .single();

      if (error) throw error;

      toast.success('Event created successfully');
      navigate(`/events/${newEvent.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon">
          <Link to="/events">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create Event</h1>
          <p className="text-muted-foreground">Add a new event to the platform.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>The core details about your event.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="event_title">Title *</Label>
              <Input
                id="event_title"
                placeholder="Enter event title"
                {...register('event_title')}
              />
              {errors.event_title && (
                <p className="text-sm text-destructive">{errors.event_title.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="event_description">Description</Label>
              <Textarea
                id="event_description"
                placeholder="Describe your event..."
                rows={5}
                {...register('event_description')}
              />
              {errors.event_description && (
                <p className="text-sm text-destructive">{errors.event_description.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={status}
                onValueChange={(value) => setValue('status', value as 'incomplete' | 'published')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incomplete">Incomplete</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Date & Time */}
        <Card>
          <CardHeader>
            <CardTitle>Date & Time</CardTitle>
            <CardDescription>When does the event take place?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="event_start">Start Date & Time *</Label>
                <Input
                  id="event_start"
                  type="datetime-local"
                  {...register('event_start')}
                />
                {errors.event_start && (
                  <p className="text-sm text-destructive">{errors.event_start.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="event_end">End Date & Time</Label>
                <Input
                  id="event_end"
                  type="datetime-local"
                  {...register('event_end')}
                />
                {errors.event_end && (
                  <p className="text-sm text-destructive">{errors.event_end.message}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Location */}
        <Card>
          <CardHeader>
            <CardTitle>Location</CardTitle>
            <CardDescription>Where does the event take place?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="event_location">Location Name</Label>
              <Input
                id="event_location"
                placeholder="Convention Center, Room 101"
                {...register('event_location')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="event_type">Event Type</Label>
              <Input
                id="event_type"
                placeholder="Conference, Meetup, Workshop..."
                {...register('event_type')}
              />
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex items-center justify-end gap-4">
          <Button asChild variant="outline">
            <Link to="/events">Cancel</Link>
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Event
          </Button>
        </div>
      </form>
    </div>
  );
}
