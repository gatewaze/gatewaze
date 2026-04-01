import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';

const DEFAULT_PRIMARY = '#00a2c7';

export default function GradientBackground() {
  const [color, setColor] = useState(DEFAULT_PRIMARY);

  useEffect(() => {
    async function loadColor() {
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from('platform_settings')
          .select('key, value')
          .eq('key', 'primary_color')
          .single();
        if (data?.value) setColor(data.value);
      } catch {
        // Use default
      }
    }
    loadColor();
  }, []);

  return (
    <div
      className="gradient-bg-container"
      style={{ '--blob-color': color } as React.CSSProperties}
    >
      <div className="gradient-blob gradient-blob-1" />
      <div className="gradient-blob gradient-blob-2" />
      <div className="gradient-blob gradient-blob-3" />
    </div>
  );
}
