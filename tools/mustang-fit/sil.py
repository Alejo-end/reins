# silhouette of the model body (Group_008) seen from the front, in model units (inches)
import pickle, numpy as np, json
from PIL import Image, ImageDraw
import contourpy
V,G=pickle.load(open('obj.pkl','rb'))
def sil(groups, ppu=200, pad=1):
    ids=[abs(i)-1 for g in groups for f in G[g] for i in f]
    P=V[np.array(ids)]
    x0,y0=P[:,0].min()-pad,P[:,1].min()-pad; x1,y1=P[:,0].max()+pad,P[:,1].max()+pad
    W,H=int((x1-x0)*ppu),int((y1-y0)*ppu)
    im=Image.new('L',(W,H),0); d=ImageDraw.Draw(im)
    for g in groups:
        for f in G[g]:
            q=[((V[abs(i)-1][0]-x0)*ppu,(V[abs(i)-1][1]-y0)*ppu) for i in f]
            d.polygon(q,fill=255)
    a=np.asarray(im).astype(float)/255
    lines=contourpy.contour_generator(z=a).lines(0.5)
    L=max(lines,key=len)
    return np.c_[L[:,0]/ppu+x0, L[:,1]/ppu+y0]
body=sil(['Group_008'])
head=sil(['Group_052'])
print(len(body), body.min(0), body.max(0), len(head), head.min(0), head.max(0))
np.save('body_in.npy',body); np.save('neck_in.npy',head)
