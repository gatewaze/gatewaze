-- RPC: events_update_screenshot_status
-- Used by the screenshot worker to update event screenshot fields (bypasses RLS)
CREATE OR REPLACE FUNCTION public.events_update_screenshot_status(
    p_event_id varchar,
    p_screenshot_generated boolean,
    p_screenshot_url text DEFAULT NULL,
    p_screenshot_generated_at timestamptz DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.events SET
        screenshot_generated = p_screenshot_generated,
        screenshot_url = p_screenshot_url,
        screenshot_generated_at = p_screenshot_generated_at,
        updated_at = NOW()
    WHERE event_id = p_event_id;

    RETURN FOUND;
END;
$$;
