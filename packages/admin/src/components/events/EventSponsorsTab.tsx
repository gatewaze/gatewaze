// @ts-nocheck
import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Sponsor } from '@gatewaze/shared';

interface EventSponsorRow {
  id: string;
  sponsor_id: string;
  sponsorship_tier?: string;
  booth_number?: string;
  is_active: boolean;
  sponsors: Sponsor;
}

const TIER_COLORS: Record<string, string> = {
  platinum: 'bg-slate-200 text-slate-800',
  gold: 'bg-yellow-100 text-yellow-800',
  silver: 'bg-gray-100 text-gray-800',
  bronze: 'bg-orange-100 text-orange-800',
  partner: 'bg-blue-100 text-blue-800',
  exhibitor: 'bg-green-100 text-green-800',
};

interface Props {
  eventId: string;
}

export function EventSponsorsTab({ eventId }: Props) {
  const [eventSponsors, setEventSponsors] = useState<EventSponsorRow[]>([]);
  const [allSponsors, setAllSponsors] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addForm, setAddForm] = useState({ sponsor_id: '', tier: '', booth: '' });
  const [newSponsor, setNewSponsor] = useState({ name: '', website: '', contact_email: '' });

  const fetchData = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('event_sponsors')
      .select('*, sponsors(*)')
      .eq('event_id', eventId)
      .order('sponsorship_tier');
    if (error) toast.error('Failed to load sponsors');
    setEventSponsors((data ?? []) as unknown as EventSponsorRow[]);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function loadAllSponsors() {
    const supabase = getSupabase();
    const { data } = await supabase.from('sponsors').select('*').eq('is_active', true).order('name');
    setAllSponsors(data ?? []);
  }

  async function addSponsor() {
    if (!addForm.sponsor_id) return;
    setSaving(true);
    const supabase = getSupabase();
    const { error } = await supabase.from('event_sponsors').insert({
      event_id: eventId,
      sponsor_id: addForm.sponsor_id,
      sponsorship_tier: addForm.tier || null,
      booth_number: addForm.booth || null,
    });
    if (error) toast.error(error.message.includes('duplicate') ? 'Sponsor already added' : error.message);
    else {
      toast.success('Sponsor added');
      setShowAdd(false);
      setAddForm({ sponsor_id: '', tier: '', booth: '' });
      await fetchData();
    }
    setSaving(false);
  }

  async function removeSponsor(id: string) {
    const supabase = getSupabase();
    await supabase.from('event_sponsors').delete().eq('id', id);
    toast.success('Sponsor removed');
    await fetchData();
  }

  async function createSponsor() {
    if (!newSponsor.name.trim()) return;
    setSaving(true);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('sponsors')
      .insert({
        name: newSponsor.name,
        website: newSponsor.website || null,
        contact_email: newSponsor.contact_email || null,
      })
      .select('id')
      .single();
    if (error) toast.error(error.message);
    else {
      setAddForm(p => ({ ...p, sponsor_id: data.id }));
      setShowCreate(false);
      setNewSponsor({ name: '', website: '', contact_email: '' });
      await loadAllSponsors();
      toast.success('Sponsor created');
    }
    setSaving(false);
  }

  if (loading) return <Card><CardContent className="py-8"><div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></CardContent></Card>;

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Sponsors ({eventSponsors.length})</CardTitle>
          <Button size="sm" onClick={() => { setShowAdd(true); loadAllSponsors(); }}>
            <Plus className="mr-1 h-4 w-4" /> Add sponsor
          </Button>
        </CardHeader>
        <CardContent>
          {eventSponsors.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No sponsors assigned to this event.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sponsor</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Booth</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventSponsors.map(es => (
                  <TableRow key={es.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {es.sponsors.logo_url && <img src={es.sponsors.logo_url} alt="" className="h-8 w-8 rounded object-contain" />}
                        <span className="font-medium">{es.sponsors.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {es.sponsorship_tier && (
                        <Badge className={TIER_COLORS[es.sponsorship_tier] || ''} variant="outline">
                          {es.sponsorship_tier}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{es.booth_number || '—'}</TableCell>
                    <TableCell>
                      {es.sponsors.website && (
                        <a href={es.sponsors.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-sm truncate max-w-40 block">
                          {es.sponsors.website}
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeSponsor(es.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add sponsor</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Sponsor</Label>
              <Select value={addForm.sponsor_id} onValueChange={(v) => setAddForm(p => ({ ...p, sponsor_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select sponsor" /></SelectTrigger>
                <SelectContent>
                  {allSponsors.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tier</Label>
              <Select value={addForm.tier} onValueChange={(v) => setAddForm(p => ({ ...p, tier: v }))}>
                <SelectTrigger><SelectValue placeholder="Select tier" /></SelectTrigger>
                <SelectContent>
                  {['platinum', 'gold', 'silver', 'bronze', 'partner', 'exhibitor'].map(t => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Booth Number</Label>
              <Input value={addForm.booth} onChange={(e) => setAddForm(p => ({ ...p, booth: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAdd(false); setShowCreate(true); }}>Create new sponsor</Button>
            <Button onClick={addSponsor} disabled={saving || !addForm.sponsor_id}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create sponsor</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name *</Label><Input value={newSponsor.name} onChange={(e) => setNewSponsor(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Website</Label><Input value={newSponsor.website} onChange={(e) => setNewSponsor(p => ({ ...p, website: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Contact Email</Label><Input value={newSponsor.contact_email} onChange={(e) => setNewSponsor(p => ({ ...p, contact_email: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createSponsor} disabled={saving || !newSponsor.name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
