import json,os,sys
from PIL import Image,ImageDraw
L="/mnt/e/Stable Diffusion.library"
idx=json.load(open(os.path.join(os.path.dirname(__file__),'eagle-index.json')))
def thumb(it):
    d=os.path.join(L,'images',it['dir'])
    for f in os.listdir(d):
        if f.endswith('_thumbnail.png'): return os.path.join(d,f)
    for f in os.listdir(d):
        if f.lower().endswith(('.png','.jpg','.webp')) and f!='metadata.json': return os.path.join(d,f)
def sheet(items,out,cols=12,cell=180,label=lambda i:i['name'][:28]):
    rows=(len(items)+cols-1)//cols
    im=Image.new('RGB',(cols*cell,rows*(cell+14)),(20,20,20)); dr=ImageDraw.Draw(im)
    for n,it in enumerate(items):
        x,y=(n%cols)*cell,(n//cols)*(cell+14)
        try:
            t=Image.open(thumb(it)).convert('RGB'); t.thumbnail((cell-4,cell-4)); im.paste(t,(x+2,y+2))
        except Exception as e: dr.text((x+4,y+4),'?',fill=(255,80,80))
        dr.text((x+3,y+cell+1),label(it),fill=(200,200,200))
    im.save(out); print(out,len(items),'items')
if __name__=='__main__':
    mode=sys.argv[1]; items=[i for i in idx['items'] if not i['deleted']]
    if mode=='folder':
        key=sys.argv[2]; sel=[i for i in items if any(f.startswith(key) for f in i['folders'])]
        sel.sort(key=lambda i:(i['folders'][0] if i['folders'] else '',i['btime'] or 0))
        sheet(sel,sys.argv[3],label=lambda i:(i['folders'][0].split('/')[-1][:14]+' '+(i['name'] or '')[:12]))
    elif mode=='unfiled':
        sel=[i for i in items if not i['folders']]; sel.sort(key=lambda i:-(i['btime'] or 0))
        sheet(sel[:int(sys.argv[2])],sys.argv[3],label=lambda i:(i['name'] or '')[:28])
    elif mode=='sample':
        import random; random.seed(1); key=sys.argv[2]; n=int(sys.argv[3])
        sel=[i for i in items if any(f.startswith(key) for f in i['folders'])]; random.shuffle(sel)
        sheet(sel[:n],sys.argv[4],label=lambda i:(i['folders'][0].split('/')[-1][:14]+' '+(i['name'] or '')[:12]))
