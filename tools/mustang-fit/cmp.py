import json, numpy as np
from PIL import Image, ImageDraw, ImageFont
REF='/Users/alejandrodeleon/Documents/NewMedia_Master/digitalFabrication/midiguitar/reins-guitar/pickguard/'
g=json.load(open('/Users/alejandrodeleon/Documents/NewMedia_Master/reins-site/src/guitar.json'))
old=json.load(open('guitar.orig.json'))
seg=json.load(open(REF+'v2/web/body_outline.json'))['segments']
meas=json.load(open(REF+'ref/measured.json'))
def make(x0,x1,y0,y1,ppm,photos,out):
    W,H=int((x1-x0)*ppm),int((y1-y0)*ppm)
    im=Image.new('RGBA',(W,H),(28,28,30,255))
    for ph in photos:
        p=Image.open(REF+'v2/ref/'+ph).convert('RGBA')
        p=p.resize((int(420*ppm),int(400*ppm)))
        a=np.asarray(p).copy(); a[...,3]=(a[...,3]*0.85).astype(np.uint8); p=Image.fromarray(a)
        im.alpha_composite(p,(int((-120-x0)*ppm),int((y1-290)*ppm)))
    d=ImageDraw.Draw(im)
    P=lambda pts:[((x-x0)*ppm,(y1-y)*ppm) for x,y in pts]
    w=max(2,int(ppm))
    d.line(P(old['body']+[old['body'][0]]),fill=(0,220,255),width=w)
    b=g['body']; d.line(P(b+[b[0]]),fill=(255,220,0),width=w+1)
    for s in seg[:2]: d.line(P(s['points']),fill=(255,0,200),width=w)
    n=g['neck']; nutX=g['saddleX']+g['scale']; c=n['centreY']; ch=n['heelCentreY']
    nk=[[n['heelX'],ch-28],[nutX,c-21],[nutX,c+21],[n['heelX'],ch+28]]; d.line(P(nk+[nk[0]]),fill=(120,255,120),width=w)
    hs=[[nutX+x,c+y] for x,y in g['headstock']]; d.line(P(hs+[hs[0]]),fill=(120,255,120),width=w)
    t=g['tuners']
    for i in range(6):
        x,y=nutX+t['x0']+i*t['pitch'], c+t['y']+i*t['dy']; (px,py),=P([[x,y]]); r=3.2*ppm; d.ellipse([px-r,py-r,px+r,py+r],outline=(120,255,120),width=w)
    s=g['strings']
    for i in range(6):
        k=(i-2.5)/5; d.line(P([[g['saddleX'],s['y']-k*s['saddleSpread']],[nutX,c-k*s['nutSpread']]]),fill=(200,200,200),width=1)
    for h in meas['guard_screws']:
        (px,py),=P([[h['cx'],h['cy']]]); r=2.5*ppm; d.ellipse([px-r,py-r,px+r,py+r],outline=(255,60,60),width=w)
    for x in range(-200,int(x1),100):
        (px,py),=P([[x,y0]]); d.line([(px,py),(px,py-8*ppm)],fill='white',width=1); d.text((px+2,py-14*ppm),str(x),fill='white')
    d.text((10,10),'yellow: new body (Mustang model fitted)  cyan: old body  magenta: photo traces (treble edge, bass horn)  green: neck, headstock, tuners  red: pickguard screws',fill='white')
    im.convert('RGB').save(out)
make(-230,830,-70,300,1.6,['IMG_2408-rectified.png','IMG_2407-rectified.png'],'mustang-compare-full.png')
make(-230,300,-70,300,3,['IMG_2407-rectified.png'],'mustang-compare-body-2407.png')
make(-230,300,-70,300,3,['IMG_2408-rectified.png'],'mustang-compare-body-2408.png')
