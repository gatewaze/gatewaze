#!/usr/bin/env python3
"""
Migrate the old MLOps Community newsletter (sent via Customer.io, BEE editor)
into the Gatewaze "AAIF User Community" newsletter as native editions/blocks/
bricks, re-hosting all images into Supabase storage.

Read-only by default (--dry-run). Writes (image uploads + DB inserts) only
with --commit. Targets whatever Supabase the env points at (localhost first,
then production).

Env required:
  CUSTOMERIO_APP_API_KEY   Customer.io App API key (US region)
  SUPABASE_URL             target Supabase (e.g. http://supabase.aaif.localhost)
  SUPABASE_SERVICE_ROLE_KEY  service-role key (write access)

Usage:
  python3 migrate-cio-newsletter.py --dry-run [--limit N]
  python3 migrate-cio-newsletter.py --commit  [--limit N]
"""
import os, re, sys, json, time, urllib.request, urllib.parse, html as htmllib, argparse, mimetypes
from html.parser import HTMLParser

CIO_BASE = "https://api.customer.io/v1"
COLLECTION_SLUG = "usercommunity"
MIN_BLOCKS = 3   # skip editions that parse to fewer (newer single-mega-row / short format)
IMG_HOST_ALLOW = re.compile(r'(customeriomail\.com|customer\.io|db\.mlops\.community|mlops\.community)', re.I)
IMG_PATH_PREFIX = "newsletters/newsletter-images"   # relative path stored in content

# ───────────────────────── HTTP ─────────────────────────
CACHE_DIR = "/tmp/cio_migrate_cache"
def _req(url, method="GET", headers=None, data=None, tries=4):
    last=None
    for i in range(tries):
        try:
            r = urllib.request.Request(url, method=method, headers=headers or {}, data=data)
            with urllib.request.urlopen(r, timeout=60) as resp:
                return resp.status, resp.read(), dict(resp.getheaders())
        except Exception as e:
            last=e; time.sleep(2*(i+1))
    raise last

def cio_get(path):
    key = os.environ["CUSTOMERIO_APP_API_KEY"].strip()
    s, b, _ = _req(f"{CIO_BASE}{path}", headers={"Authorization": f"Bearer {key}"})
    return json.loads(b)

def sb_headers(extra=None):
    k = os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()
    h = {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}
    if extra: h.update(extra)
    return h

def sb_get(path):
    url = os.environ["SUPABASE_URL"] + "/rest/v1/" + path
    s, b, _ = _req(url, headers=sb_headers())
    return json.loads(b)

def sb_insert(table, row):
    url = os.environ["SUPABASE_URL"] + f"/rest/v1/{table}"
    s, b, _ = _req(url, "POST", sb_headers({"Prefer": "return=representation"}),
                   json.dumps(row).encode())
    return json.loads(b)[0]

def sb_storage_upload(path, content_bytes, content_type):
    url = os.environ["SUPABASE_URL"] + "/storage/v1/object/media/" + urllib.parse.quote(path)
    k = os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()
    _req(url, "POST", {"apikey": k, "Authorization": f"Bearer {k}",
                       "Content-Type": content_type, "x-upsert": "true"}, content_bytes)
    return path

# ───────────────────────── parser (v3 + polish) ─────────────────────────
ALLOWED = {'p','strong','em','b','i','u','a','ul','ol','li','br'}

def promote_styled_headings(h):
    """Customer.io/BEE editions express section headings as large-font bold
    spans (no real <h> tags). Convert `<span style="...font-size:18-99px...">
    <strong>X</strong></span>` to <h3>X</h3> so they render as headings, not
    plain bold. Also handles <p>-level large-font wrappers."""
    h=re.sub(r'<span[^>]*font-size:\s*(?:1[89]|[2-9]\d)px[^>]*>\s*<strong>(.*?)</strong>\s*</span>',
             r'<h3>\1</h3>', h, flags=re.S|re.I)
    return h

class RowFields(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out=[]; self.label=[]; self.title=''
        self.in_head=0; self.in_strong=0; self.in_li=0; self.cap_title=True
        self.links=[]; self.images=[]; self._cur_a=None; self._a_txt=[]
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='h1': self.in_head+=1; return            # block label
        if tag in ('h2','h3','h4'): self.out.append('<h3>'); return  # body heading
        if tag=='img':
            src=a.get('src','')
            if src: self.images.append(src); self.out.append(f'<img src="{src}" />')  # keep inline
            return
        if tag=='li': self.in_li+=1
        if tag=='a':
            self._cur_a=a.get('href',''); self._a_txt=[]
            self.out.append(f'<a href="{a.get("href","")}">'); return
        if tag=='strong': self.in_strong+=1
        if tag in ALLOWED: self.out.append(f'<{tag}>')
    def handle_endtag(self, tag):
        if tag=='h1': self.in_head=max(0,self.in_head-1); return
        if tag in ('h2','h3','h4'): self.out.append('</h3>'); return
        if tag=='img': return
        if tag=='li': self.in_li=max(0,self.in_li-1)
        if tag=='a':
            if self._cur_a is not None:
                self.links.append({'text':''.join(self._a_txt).strip(),'href':self._cur_a})
            self._cur_a=None; self.out.append('</a>'); return
        if tag=='strong':
            self.in_strong=max(0,self.in_strong-1)
            if self.in_strong==0 and not self.in_li: self.cap_title=False
        if tag in ALLOWED: self.out.append(f'</{tag}>')
    def handle_data(self, data):
        if self.in_head: self.label.append(data); return
        if self._cur_a is not None: self._a_txt.append(data)
        if self.in_strong and self.cap_title and not self.in_head and not self.in_li and self._cur_a is None:
            self.title+=data   # bold LINK text (Video/Spotify/Apple, "here.") is not a title
        self.out.append(htmllib.escape(data,quote=False))

def richtext(out):
    s=''.join(out)
    s=re.sub(r'<a href="[^"]*">\s*</a>','',s)   # drop empty anchors (polish #1)
    s=re.sub(r'<p>\s*(<h3>.*?</h3>)\s*</p>', r'\1', s)  # unwrap p-wrapped headings
    # strip the "Forwarded this email? Subscribe here" chrome that prefixes
    # some intros in the mid-2025 editions
    s=re.sub(r'<p>[^<]*forwarded this email\?(?:(?!</p>).)*</p>','',s,flags=re.I)
    s=re.sub(r'<h3>\s*</h3>','',s)              # drop empty headings
    s=re.sub(r'<p>\s*</p>','',s)
    s=re.sub(r'\s+',' ',s).strip()
    return s

def split_rows(doc):
    rows=[]; cap=False; depth=0; start=0
    for m in re.finditer(r'<table\b[^>]*>|</table>', doc, re.I):
        t=m.group(0); opening=not t.startswith('</')
        if not cap:
            if opening and re.search(r'class="[^"]*\brow row-\d+', t):
                cap=True; depth=1; start=m.start()
        else:
            depth += 1 if opening else -1
            if depth==0: rows.append(doc[start:m.end()]); cap=False
    return rows

def extract(row):
    row=promote_styled_headings(row)
    p=RowFields(); p.feed(row)
    label=re.sub(r'\s+',' ',''.join(p.label)).strip()
    title=re.sub(r'\s+',' ',p.title).strip()
    if not re.search(r'[a-zA-Z0-9]', title): title=''   # ignore separator-only titles ("|| ||")
    body=richtext(p.out)
    def lead_h3():
        m=re.match(r'\s*<h3>(.*?)</h3>', body)
        return (re.sub(r'<[^>]+>','',m.group(1)).strip(), m.end()) if m else (None,0)
    # 2025 editions put the section eyebrow (PODCAST/BLOG/ML CONFESSIONS) and the
    # item title in leading <h3>s, not <h1>. A SHORT leading h3 = the section
    # eyebrow (use it as the label so classify() routes the block correctly);
    # the NEXT leading h3 = the item title.
    if not label:
        eb,end=lead_h3()
        if eb and len(eb.split())<=4: label=eb; body=body[end:].strip()
    if not title:
        th,end=lead_h3()
        if th and re.match(r'\s*<h3>',body): title=th; body=body[end:].strip()
    return {'label':label,'title':title,'body':body,
            'links':[l for l in p.links if l['text'] or l['href']],
            'images':p.images}

def strip_lead_title(body, title):
    if not title: return body
    m=re.match(r'\s*<p>\s*(?:<strong>)?\s*(.*?)\s*(?:</strong>)?\s*</p>', body)
    if m and re.sub(r'<[^>]+>','',m.group(1)).strip()[:50]==title[:50]:
        return body[m.end():].strip()
    return body

def parse_li_items(body):
    items=[]
    for li in re.findall(r'<li>(.*?)</li>', body, re.S):
        a=re.search(r'<a href="([^"]*)">(.*?)</a>', li, re.S)
        items.append({'text':re.sub(r'\s+',' ',re.sub(r'<[^>]+>','',li)).strip(),
                      'link_url':a.group(1) if a else '',
                      'link_text':re.sub(r'<[^>]+>','',a.group(2)).strip() if a else ''})
    return items

NOISE=re.compile(r'view (a )?web copy|view in browser|view_in_browser|unsubscribe|'
                 r'manage (your )?preferences|%recipient|update your profile|'
                 r'no longer wish to receive|all rights reserved', re.I)
def is_chrome(sec, idx):
    bt=re.sub(r'<[^>]+>','',sec['body'])
    has=bool(re.sub(r'[\s|&;]+','',bt) or sec['label'] or sec['title'])
    if idx<=1 and sec['images'] and not sec['label'] and not sec['title'] and len(bt)<40: return True
    if NOISE.search(sec['label']+' '+bt+' '+' '.join(l['href'] for l in sec['links'])): return True
    # Brand header / masthead banner ("here." wordmark + logo + IRL meetup
    # locations). These editions put a "Stay up to date with your local
    # chapter" banner up top listing IRL event cities; per request, drop it.
    if re.search(r'stay up to date with your local chapter', bt, re.I): return True
    if idx<=3 and (sec['title'] or sec['label']).strip().lower().rstrip('.')=='here' and sec['images']: return True
    if not has and not sec['images']: return True
    return False

def classify(sec):
    L=sec['label'].lower(); B=re.sub(r'<[^>]+>','',sec['body']).lower(); T=sec['title'].lower()
    txt=f'{L} || {T} || {B}'
    if 'podcast' in L:                                    return ('mlops_community','podcast')
    if re.search(r'\breading group\b',txt):               return ('mlops_community','reading_group')
    if L in ('blog','blogs') or 'read the blog' in B:     return ('mlops_community','blog_post')
    if re.search(r'\b(irl )?meetup',txt):                 return ('mlops_community','generic_section')
    if re.search(r'hidden gem',txt):                      return ('hidden_gems',None)
    if re.search(r'job of the week|jobs board',txt):      return ('job_of_week',None)
    if re.search(r'hot take',txt):                        return ('hot_take',None)
    if re.search(r"last week'?s? take",txt):              return ('last_weeks_take',None)
    if re.search(r'\bmeme\b',txt):                        return ('meme_of_week',None)
    if re.search(r'confession',txt):                      return ('ml_confessions',None)
    if re.search(r'sponsor|brought to you|presented by|in partnership|our partner',txt):
        return ('sponsored_ad',None)
    return ('generic',None)

def first_link(links, rx=r'.'):
    for l in links:
        if re.search(rx,l['text'],re.I): return l
    return links[0] if links else None

# Section names that the BLOCK TEMPLATE already renders as an eyebrow. The
# source repeats them in the content, so strip a leading occurrence to avoid
# the "MLOPS COMMUNITY / MLOps Community" double-heading.
_EB=r'(?:hot take|mlops community|ml confessions|hidden gems|job of the week|last week\W*s take|meme of the week|how we(?: can)? help|agent infrastructure|reading group|podcast|blogs?|curated finds[^<.]*)'
# strip a leading eyebrow that may sit inside any nesting of opening tags
# (<p>, <strong>, <span>, <h3>...): re-emit the opening tags, drop the phrase,
# then clean up the now-empty inline/paragraph tags it leaves behind.
EYEBROW_HTML=re.compile(r'^((?:\s*<[^/][^>]*>)*)\s*(?:💡\s*)?'+_EB+r'[:.\-—\s]*', re.I)
EYEBROW_FULL=re.compile(r'^\W*(?:💡\s*)?'+_EB+r'\W*$', re.I)
def strip_eyebrow_html(s):
    if not s: return s
    s=EYEBROW_HTML.sub(lambda mm: mm.group(1) or '', s, count=1)
    s=re.sub(r'<(strong|b|em|span|h3)>\s*</\1>','',s)   # emptied inline tags
    s=re.sub(r'<p>\s*</p>','',s)                        # emptied paragraph
    return s.strip()

# When a title field is empty but the body opens with a standalone heading
# (a whole-paragraph <strong>…</strong> or a leading <h3>), lift it into the
# title field so the block's title isn't blank with the heading stuck in body.
_LEAD_HEADING=re.compile(r'^\s*<p>\s*<strong>(.*?)</strong>\s*</p>\s*|^\s*<h3>(.*?)</h3>\s*', re.S)
def promote_body_title(title, body):
    if title: return title, body
    m=_LEAD_HEADING.match(body or '')
    if m:
        t=re.sub(r'<[^>]+>','',m.group(1) or m.group(2) or '').strip()
        if t: return t, body[m.end():].strip()
    return title, body
def clean_title(t): return '' if (t and EYEBROW_FULL.match(t)) else t  # title that's ONLY an eyebrow → drop

def assemble(block, brick, sec):
    sec=dict(sec)
    sec['title']=clean_title(sec['title'])                      # drop eyebrow-only titles
    sec['label']='' if EYEBROW_FULL.match(sec['label'] or '') else sec['label']
    desc=strip_eyebrow_html(strip_lead_title(sec['body'], sec['title']))   # de-dup leading eyebrow
    sec['title'], desc = promote_body_title(sec['title'], desc)            # lift leading heading → title
    L=lambda r='.':first_link(sec['links'],r) or {}
    if brick=='podcast':
        return {'title':sec['title'] or sec['label'],'description':desc,
                'video_link':L(r'video|watch|youtube').get('href',''),'spotify_link':L(r'spotify').get('href',''),
                'apple_link':L(r'apple').get('href','')}
    if brick=='blog_post':
        return {'title':sec['title'] or sec['label'],'description':desc,'blog_link':L().get('href',''),
                'link_text':L().get('text','') or 'Read the blog'}
    if brick=='reading_group':
        return {'title':sec['title'] or sec['label'],'description':desc,'link':L().get('href',''),
                'link_text':L().get('text','') or 'Join the reading group'}
    if brick=='generic_section':
        return {'section_title':sec['label'],'title':sec['title'],'description':desc,
                'link':L().get('href',''),'link_text':L().get('text','')}
    strip_imgs=lambda s: re.sub(r'\s*<img[^>]*/?>\s*','',s).strip()
    if block=='intro_paragraph':  return {'text':sec['body']}   # inline images kept
    if block=='meme_of_week':     return {'image_url':sec['images'][0] if sec['images'] else ''}
    if block=='sponsored_ad':
        # dedicated image_url field -> strip the inline copy from the body
        return {'sponsor_name':'','headline':sec['title'] or sec['label'],
                'image_url':sec['images'][0] if sec['images'] else '','image_link':L().get('href',''),
                'body':strip_imgs(desc),'cta_text':L().get('text',''),'cta_link':L().get('href','')}
    if block=='hidden_gems':
        items=parse_li_items(sec['body'])
        gems=[{'link_text':it['link_text'] or it['text'][:40],'link_url':it['link_url'],'description':it['text']} for it in items] \
             or [{'link_text':l['text'],'link_url':l['href'],'description':''} for l in sec['links']]
        return {'title':sec['label'] or 'Hidden Gems','gems':gems}
    if block=='job_of_week':
        board=(first_link(sec['links'],r'jobs?\s*board') or {}).get('href','')
        apply=(first_link([l for l in sec['links'] if 'board' not in l['text'].lower()]) or {}).get('href','')
        txt=re.sub(r'<[^>]+>',' ',desc); txt=re.sub(r'\s+',' ',txt)
        txt=re.sub(r'\s*(?:find|there are|\+)?\s*\d+\s+more roles.*$','',txt,flags=re.I).strip()  # drop "5 more roles..."
        jobs=[]
        mm=re.match(r'(.+?)\s*//\s*([^()/]+?)(?:\s*\((.*?)\))?(?:\s+(.*))?$', txt, re.S)
        if mm and '//' in txt:   # single "Title // Company (Location) description" job (bullets stay in description)
            jobs.append({'job_title':mm.group(1).strip()[:120],'company':mm.group(2).strip(),
                         'location':(mm.group(3) or '').strip(),'apply_link':apply,
                         'description':(mm.group(4) or '').strip()[:600]})
        else:
            for it in parse_li_items(sec['body']):   # genuine list of multiple jobs
                jobs.append({'job_title':it['link_text'] or it['text'][:60],'company':'','location':'',
                             'apply_link':it['link_url'] or apply,'description':''})
            if not jobs and txt: jobs.append({'job_title':txt[:80],'company':'','location':'','apply_link':apply,'description':''})
        return {'header_title':sec['label'] or 'Job of the Week','jobs':jobs,'jobs_board_url':board}
    if block=='hot_take':
        # poll options are labeled links (often duplicated desktop/mobile);
        # dedupe by label, take the first two distinct as option 1 & 2.
        seen=[]
        for l in sec['links']:
            t=l['text'].strip()
            if t and t.lower() not in [s[0].lower() for s in seen]: seen.append((t,l['href']))
        o=seen+[('',''),('','')]
        return {'title':sec['title'] or sec['label'],'body':desc,
                'poll_option_1_label':o[0][0],'poll_option_1_link':o[0][1],
                'poll_option_2_label':o[1][0],'poll_option_2_link':o[1][1]}
    if block=='last_weeks_take': return {'title':sec['title'] or sec['label'],'body':desc}
    if block=='ml_confessions':   # schema: title / story / confess_link (not generic)
        # the confess CTA is its own field; strip the inline copy from the story
        story=re.sub(r'<p>(?:(?!</p>).)*?(?:share your confession|confess(?:ion)?s?(?:(?!</p>).){0,40}here)(?:(?!</p>).)*?</p>','',desc,flags=re.I)
        story=re.sub(r'<a [^>]*>[^<]*(?:confession|confess)[^<]*</a>','',story,flags=re.I)
        story=re.sub(r'<p>\s*</p>','',story).strip()
        return {'title':sec['title'],'story':story,
                'confess_link':(first_link(sec['links'],r'confess|submit|share|here') or L()).get('href','')}
    # generic: images stay INLINE in the body richtext. useful_links removed per
    # request — the source's trailing links often go nowhere / are chrome.
    return {'heading':sec['label'],'title':sec['title'],'body':desc}

def parse_edition(doc):
    blocks=[]; cur=None; intro=False; seen=set()
    for idx,row in enumerate(split_rows(doc)):
        sec=extract(row)
        if is_chrome(sec, idx): continue
        target,brick=classify(sec)
        if target=='sponsored_ad':         # drop sponsor blocks (not relevant for AAIF)
            cur=None; continue
        # first prose panel (no label/image) is the intro, regardless of length
        if (not intro and target=='generic' and not brick and not sec['label']
                and not sec['images'] and len(re.sub(r'<[^>]+>','',sec['body']).strip())>15):
            target='intro_paragraph'; intro=True
        if brick:
            if cur is None: cur={'block':'mlops_community','content':{},'bricks':[]}; blocks.append(cur)
            cur['bricks'].append({'brick':brick,'content':assemble('mlops_community',brick,sec)})
        else:
            content=assemble(target,None,sec)
            # drop near-empty generic panels + de-dup identical consecutive panels
            # (e.g. desktop/mobile "PROGRESS LOOP" ad variants)
            if target=='generic':
                txt=re.sub(r'<[^>]+>','',content.get('body','')).strip()
                short_caps=bool(re.fullmatch(r'[A-Z0-9][A-Z0-9 &/\-]{1,28}', txt))  # ad-banner label e.g. "PROGRESS LOOP"
                if (len(txt)<15 and not sec['images']) or short_caps: continue
            sig=(target, json.dumps(content,sort_keys=True))
            if sig in seen: continue
            seen.add(sig)
            cur=None; blocks.append({'block':target,'content':content})
    return blocks

# ───────────────────────── image re-host ─────────────────────────
def _imgmap_path(): return os.environ.get("CIO_IMAGE_MAP", os.path.join(CACHE_DIR, "image_map.json"))
def _load_imgmap():
    try: return json.load(open(_imgmap_path()))
    except Exception: return {}
_imgcache=_load_imgmap()
def rehost_image(url, date, commit):
    if not url or not url.startswith('http'): return url
    # reuse a prior REAL upload (file still in storage even after a DB wipe)
    prev=_imgcache.get(url)
    if prev and '<uploaded' not in prev: return prev
    if not IMG_HOST_ALLOW.search(url):
        return url  # leave foreign hosts as-is
    if not commit:
        _imgcache[url]=f"{IMG_PATH_PREFIX}/cio-{date}-<uploaded-on-commit>"; return _imgcache[url]
    try:
        s,b,h=_req(url); ctype=h.get('Content-Type','image/png').split(';')[0]
        ext=mimetypes.guess_extension(ctype) or '.png'
        if ext=='.jpe': ext='.jpg'
        fn=f"{IMG_PATH_PREFIX}/cio-{date}-{int(time.time()*1000)%10**10}-{len([k for k,v in _imgcache.items() if '<uploaded' not in v])}{ext}"
        sb_storage_upload(fn, b, ctype); _imgcache[url]=fn
        os.makedirs(CACHE_DIR, exist_ok=True); json.dump(_imgcache, open(_imgmap_path(),"w"))
        return fn
    except Exception as e:
        print(f"      ! image rehost failed ({e}) -> keeping original url"); return url

IMG_KEYS={'image_url'}   # ONLY these bare fields are images; link URLs are left alone
def rewrite_images(content, date, commit):
    def fix(s,key):
        if not isinstance(s,str) or 'http' not in s: return s
        if key in IMG_KEYS and s.startswith('http') and '<' not in s:
            return rehost_image(s,date,commit)         # dedicated image field
        # inside richtext: rewrite ONLY inline <img src="...">; never bare links
        return re.sub(r'src="(https?://[^"]+)"', lambda m:'src="'+rehost_image(m.group(1),date,commit)+'"', s)
    for k,v in list(content.items()):
        if isinstance(v,str): content[k]=fix(v,k)
        elif isinstance(v,list):
            for it in v:
                if isinstance(it,dict):
                    for kk,vv in it.items():
                        if isinstance(vv,str): it[kk]=fix(vv,kk)
    return content

# ───────────────────────── main ─────────────────────────
def fetch_weekly_editions():
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache=os.path.join(CACHE_DIR,"weekly_index.json")
    if os.path.exists(cache):
        return {k:v for k,v in json.load(open(cache)).items()}
    out={}; start=None
    while True:
        path="/newsletters" + (f"?start={start}" if start else "")
        d=cio_get(path)
        for n in d.get("newsletters",[]):
            nm=n.get("name","")
            if not re.search(r"Weekly Newsletter",nm): continue
            m=re.search(r"(\d{4}-\d{2}-\d{2})",nm)
            if not m: continue
            dt=m.group(1)
            if dt not in out or n["id"]>out[dt]["id"]: out[dt]=n   # latest content per date
        start=d.get("next")
        if not start: break
    json.dump(out, open(cache,"w"))
    return out

def fetch_content(nid):
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache=os.path.join(CACHE_DIR,f"content_{nid}.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    d=cio_get(f"/newsletters/{nid}/contents")["contents"][0]
    json.dump(d, open(cache,"w"))
    return d

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--commit",action="store_true"); ap.add_argument("--dry-run",action="store_true")
    ap.add_argument("--limit",type=int,default=0)
    a=ap.parse_args()
    commit = a.commit and not a.dry_run
    mode="COMMIT (writes!)" if commit else "DRY-RUN (no writes)"
    print(f"=== CIO -> AAIF usercommunity migration | {mode} | {os.environ['SUPABASE_URL']} ===")

    coll=sb_get(f"newsletters_template_collections?slug=eq.{COLLECTION_SLUG}&select=id")[0]
    cid=coll["id"]
    blockdefs={b["key"]:b["id"] for b in sb_get(f"templates_block_defs?library_id=eq.{cid}&is_current=eq.true&select=key,id")}
    mc_id=blockdefs["mlops_community"]
    brickdefs={b["key"]:b["id"] for b in sb_get(f"templates_brick_defs?block_def_id=eq.{mc_id}&select=key,id")}
    existing={e["edition_date"] for e in sb_get(f"newsletters_editions?collection_id=eq.{cid}&select=edition_date")}
    print(f"collection={cid}  existing_editions={len(existing)}  block_defs={len(blockdefs)}  brick_defs={len(brickdefs)}")

    weekly=fetch_weekly_editions()
    todo=sorted(d for d in weekly if d not in existing)
    print(f"CIO weekly dates={len(weekly)}  already_present={len(weekly)-len(todo)}  to_migrate={len(todo)}")
    if a.limit: todo=todo[:a.limit]; print(f"  (limited to {len(todo)})")

    cov={}; migrated=0; skipped_nonbee=0
    for dt in todo:
        nid=weekly[dt]["id"]
        c=fetch_content(nid)
        body=c.get("body","")
        if "row row-" not in body:
            skipped_nonbee+=1; print(f"  {dt}: skip (non-BEE format)"); continue
        blocks=parse_edition(body)
        if len(blocks) < MIN_BLOCKS:
            skipped_nonbee+=1; print(f"  {dt}: skip (only {len(blocks)} blocks - newer/short format, needs manual review)"); continue
        for blk in blocks:
            cov[blk["block"]]=cov.get(blk["block"],0)+1
            rewrite_images(blk["content"], dt, commit)
            for br in blk.get("bricks",[]): rewrite_images(br["content"], dt, commit)
        subj=c.get("subject") or weekly[dt]["name"]
        nb=sum(len(b.get("bricks",[])) for b in blocks)
        print(f"  {dt}: {len(blocks)} blocks, {nb} bricks | {subj[:50]}")
        if commit:
            ed=sb_insert("newsletters_editions",{
                "collection_id":cid,"templates_library_id":cid,"title":subj,
                "edition_date":dt,"status":"draft","preheader":c.get("preheader_text") or ""})
            for i,blk in enumerate(blocks):
                bid=blockdefs.get(blk["block"])
                row=sb_insert("newsletters_edition_blocks",{
                    "edition_id":ed["id"],"block_type":blk["block"],"content":blk["content"],
                    "block_order":i,"sort_order":i,"templates_block_def_id":bid})
                for j,br in enumerate(blk.get("bricks",[])):
                    sb_insert("newsletters_edition_bricks",{
                        "block_id":row["id"],"brick_type":br["brick"],"content":br["content"],
                        "brick_order":j,"sort_order":j,"templates_brick_def_id":brickdefs.get(br["brick"])})
        migrated+=1

    print(f"\n=== {'INSERTED' if commit else 'WOULD MIGRATE'} {migrated} editions | non-BEE skipped {skipped_nonbee} | unique images {len(_imgcache)} ===")
    print("coverage:", dict(sorted(cov.items(), key=lambda x:-x[1])))

if __name__=="__main__":
    main()
