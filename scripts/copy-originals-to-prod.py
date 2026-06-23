#!/usr/bin/env python3
"""
One-off: copy the MLOps-origin editions (already in Gatewaze block format on
localhost usercommunity) to PROD mlopscommunity, PUBLISHED.

 - remaps templates_block_def_id / templates_brick_def_id to prod's def ids (by key)
 - copies referenced media images (newsletter-images/...) localhost -> prod bucket
 - skips dates already present on prod (idempotent)

Env: LOCAL_URL LOCAL_KEY PROD_URL PROD_KEY
"""
import os, json, re, urllib.request, urllib.error

LU,LK=os.environ['LOCAL_URL'],os.environ['LOCAL_KEY'].strip()
PU,PK=os.environ['PROD_URL'],os.environ['PROD_KEY'].strip()
SRC_CID="7ffd4691-1500-4e7a-8568-c5d1ff24b10c"   # localhost usercommunity
DST_CID="c8b6aafb-ac56-41aa-a234-7e2885dc96ce"   # prod mlopscommunity
COMMIT=os.environ.get("COMMIT")=="1"

def req(url,key,method="GET",body=None,extra=None,raw=False):
    h={"apikey":key,"Authorization":f"Bearer {key}"}
    if body is not None: h["Content-Type"]="application/json"
    if extra: h.update(extra)
    r=urllib.request.Request(url,method=method,headers=h,
        data=(body if raw else json.dumps(body).encode()) if body is not None else None)
    with urllib.request.urlopen(r,timeout=90) as x:
        d=x.read(); return d if raw else (json.loads(d) if d else [])

def lget(p): return req(f"{LU}/rest/v1/{p}",LK)
def pget(p): return req(f"{PU}/rest/v1/{p}",PK)
def pins(table,row): return req(f"{PU}/rest/v1/{table}",PK,"POST",row,{"Prefer":"return=representation"})

# prod def-id maps (by key)
pblock={b["key"]:b["id"] for b in pget(f"templates_block_defs?library_id=eq.{DST_CID}&is_current=eq.true&select=key,id")}
mc=pblock["mlops_community"]
pbrick={b["key"]:b["id"] for b in pget(f"templates_brick_defs?block_def_id=eq.{mc}&select=key,id")}
has_lib=bool(pget("newsletters_editions?limit=1")) and ('templates_library_id' in pget("newsletters_editions?limit=1")[0])
prod_dates={e["edition_date"] for e in pget(f"newsletters_editions?collection_id=eq.{DST_CID}&select=edition_date")}

# source editions (published originals)
eds=lget(f"newsletters_editions?collection_id=eq.{SRC_CID}&status=eq.published&select=id,title,edition_date,preheader,content_category,metadata&order=edition_date")
print(f"source editions={len(eds)}  prod existing dates={len(prod_dates)}  commit={COMMIT}")

# collect image paths to copy
imgpaths=set()
def copy_image(path):
    if path in imgpaths: return
    imgpaths.add(path)
    if not COMMIT: return
    try:
        data=req(f"{LU}/storage/v1/object/public/media/{path}",LK,raw=True)
        ext=path.rsplit('.',1)[-1].lower()
        ct={'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','gif':'image/gif','webp':'image/webp'}.get(ext,'application/octet-stream')
        req(f"{PU}/storage/v1/object/media/{path}",PK,"POST",data,{"Content-Type":ct,"x-upsert":"true"},raw=True)
    except urllib.error.HTTPError as e:
        if e.code not in (409,):  # already exists is fine
            print(f"   img copy failed {path[:50]}: {e.code}")

migrated=skipped=0
for ed in eds:
    if ed["edition_date"] in prod_dates:
        skipped+=1; print(f"  SKIP {ed['edition_date']} (exists on prod)"); continue
    blocks=lget(f"newsletters_edition_blocks?edition_id=eq.{ed['id']}&select=id,block_type,content,block_order,sort_order&order=sort_order")
    # gather images from all content
    blob=json.dumps(blocks)
    for p in set(re.findall(r'newsletter-images/[^"\\ )]+', blob)): copy_image(p)
    print(f"  {ed['edition_date']}: {len(blocks)} blocks | {(ed['title'] or '')[:44]}")
    if not COMMIT:
        migrated+=1; continue
    row={"collection_id":DST_CID,"title":ed["title"],"edition_date":ed["edition_date"],
         "status":"published","preheader":ed.get("preheader") or "",
         "content_category":ed.get("content_category"),"metadata":ed.get("metadata")}
    if has_lib: row["templates_library_id"]=DST_CID
    ned=req(f"{PU}/rest/v1/newsletters_editions",PK,"POST",row,{"Prefer":"return=representation"})[0]
    for b in blocks:
        nb=req(f"{PU}/rest/v1/newsletters_edition_blocks",PK,"POST",{
            "edition_id":ned["id"],"block_type":b["block_type"],"content":b["content"],
            "block_order":b["block_order"],"sort_order":b["sort_order"],
            "templates_block_def_id":pblock.get(b["block_type"])},{"Prefer":"return=representation"})[0]
        bricks=lget(f"newsletters_edition_bricks?block_id=eq.{b['id']}&select=brick_type,content,brick_order,sort_order&order=sort_order")
        for br in bricks:
            req(f"{PU}/rest/v1/newsletters_edition_bricks",PK,"POST",{
                "block_id":nb["id"],"brick_type":br["brick_type"],"content":br["content"],
                "brick_order":br["brick_order"],"sort_order":br["sort_order"],
                "templates_brick_def_id":pbrick.get(br["brick_type"])},{"Prefer":"return=representation"})
    migrated+=1

print(f"\n=== {'COPIED' if COMMIT else 'WOULD COPY'} {migrated} editions | skipped {skipped} | images {len(imgpaths)} ===")
