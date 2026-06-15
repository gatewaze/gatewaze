#!/usr/bin/env python3
"""
Durable backup of the Customer.io newsletter data we're migrating, in case
API access is lost (Customer.io unpaid). Saves to a persistent directory
(NOT /tmp). Reuses the migrator's /tmp cache where present to avoid re-fetch.

Writes:
  <BACKUP>/newsletters-index-full.json   every newsletter (metadata, all pages)
  <BACKUP>/weekly-index.json             the deduped weekly editions (date -> meta)
  <BACKUP>/editions/<date>__<id>.json    full content (body HTML, subject, preheader, from...)
  <BACKUP>/MANIFEST.json                  counts + timestamp + source

Env: CUSTOMERIO_APP_API_KEY
"""
import os, re, json, time, urllib.request

BACKUP = os.environ.get("CIO_BACKUP_DIR", os.path.expanduser("~/Git/gatewaze/cio-customerio-backup"))
TMP_CACHE = "/tmp/cio_migrate_cache"
CIO = "https://api.customer.io/v1"

def req(url, tries=5):
    last=None
    for i in range(tries):
        try:
            r=urllib.request.Request(url, headers={"Authorization": f"Bearer {os.environ['CUSTOMERIO_APP_API_KEY'].strip()}"})
            with urllib.request.urlopen(r, timeout=60) as x: return json.loads(x.read())
        except Exception as e:
            last=e; time.sleep(2*(i+1))
    raise last

def main():
    os.makedirs(os.path.join(BACKUP, "editions"), exist_ok=True)
    # 1. full newsletters index (all pages)
    allnl=[]; start=None
    while True:
        d=req(f"{CIO}/newsletters" + (f"?start={start}" if start else ""))
        allnl += d.get("newsletters", [])
        start=d.get("next")
        if not start: break
    json.dump(allnl, open(os.path.join(BACKUP,"newsletters-index-full.json"),"w"), indent=1)
    print(f"newsletters-index-full.json: {len(allnl)} newsletters")

    # 2. weekly subset, deduped by date (latest id per date)
    weekly={}
    for n in allnl:
        m=re.search(r"Weekly Newsletter.*?(\d{4}-\d{2}-\d{2})", n.get("name",""))
        if not m: continue
        dt=m.group(1)
        if dt not in weekly or n["id"]>weekly[dt]["id"]: weekly[dt]=n
    json.dump(weekly, open(os.path.join(BACKUP,"weekly-index.json"),"w"), indent=1)
    print(f"weekly-index.json: {len(weekly)} weekly editions")

    # 3. full content per weekly edition (reuse /tmp cache when present)
    fetched=cached=0
    for dt,n in sorted(weekly.items()):
        nid=n["id"]
        tmp=os.path.join(TMP_CACHE, f"content_{nid}.json")
        if os.path.exists(tmp):
            content=json.load(open(tmp)); cached+=1
        else:
            content=req(f"{CIO}/newsletters/{nid}/contents")["contents"][0]; fetched+=1
        out={"edition_date":dt, "newsletter":n, "content":content}
        json.dump(out, open(os.path.join(BACKUP,"editions",f"{dt}__{nid}.json"),"w"), indent=1)
    print(f"editions/: {len(weekly)} files ({cached} from cache, {fetched} fetched)")

    json.dump({"source":"customer.io App API /v1/newsletters",
               "backup_dir":BACKUP, "total_newsletters":len(allnl),
               "weekly_editions":len(weekly),
               "note":"Durable backup; Customer.io API access at risk (unpaid)."},
              open(os.path.join(BACKUP,"MANIFEST.json"),"w"), indent=1)
    # size
    total=sum(os.path.getsize(os.path.join(dp,f)) for dp,_,fs in os.walk(BACKUP) for f in fs)
    print(f"\nBACKUP COMPLETE -> {BACKUP}  ({total/1024/1024:.1f} MB)")

if __name__=="__main__":
    main()
