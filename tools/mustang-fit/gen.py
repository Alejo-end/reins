import numpy as np, json, pickle
V,G=pickle.load(open('obj.pkl','rb'))
th,s,tx,ty=json.load(open('fit2.json'))['sim']
c,sn=np.cos(th),np.sin(th)
def F(P):
    P=np.atleast_2d(P); return np.c_[s*(c*P[:,0]-sn*P[:,1])+tx, s*(sn*P[:,0]+c*P[:,1])+ty]
def dp(P,eps):
    # Douglas-Peucker on an open polyline
    if len(P)<3: return P
    a,b=P[0],P[-1]; ab=b-a; L=np.hypot(*ab)
    d=np.abs(np.cross(ab,P-a))/L if L>0 else np.hypot(*(P-a).T)
    i=int(np.argmax(d))
    if d[i]>eps: return np.vstack([dp(P[:i+1],eps)[:-1],dp(P[i:],eps)])
    return np.vstack([a,b])
B=F(np.load('body_in.npy'))
# start at the butt end (min x), simplify each half
i0=int(np.argmin(B[:,0])); B=np.roll(B,-i0,axis=0); i1=int(np.argmax(B[:,0]))
body=np.vstack([dp(B[:i1+1],0.25)[:-1],dp(np.vstack([B[i1:],B[:1]]),0.25)[:-1]])
# CCW check
area=0.5*np.sum(body[:,0]*np.roll(body[:,1],-1)-np.roll(body[:,0],-1)*body[:,1])
print('body pts',len(body),'bbox',body.min(0).round(1),body.max(0).round(1),'area',round(area))
# headstock: the neck silhouette past the nut
N=np.load('neck_in.npy'); NUTX=12.715
inside=N[:,0]>=NUTX
k=int(np.argmin(inside)); N=np.roll(N,-k,axis=0); inside=N[:,0]>=NUTX
idx=np.where(inside)[0]; H=N[idx[0]:idx[-1]+1]
H=dp(H,0.012)
nutF=F([NUTX,6.341])[0]
axis=np.array([c,sn])
SADDLE=-8.0; SCALE=609.6; nutX=SADDLE+SCALE
heelC=120.0; slope=np.tan(th)
cNut=heelC+(nutX-166)*slope
off=np.array([nutX,cNut])-nutF
Hs=F(H)+off-np.array([nutX,cNut])
Hs=np.vstack([[0,Hs[0,1]],Hs,[0,Hs[-1,1]]]) if False else Hs
print('headstock pts',len(Hs),Hs.min(0).round(1),Hs.max(0).round(1))
posts=np.array([[14.559,7.199],[15.538,6.965],[16.509,6.737],[17.485,6.483],[18.487,6.251],[19.544,6.0]])
P=F(posts)+off-np.array([nutX,cNut])
print('posts',P.round(1))
pitch=np.mean(np.diff(P[:,0])); dy=np.mean(np.diff(P[:,1]))
neckL=F([-5.94,6.36])[0]
out=dict(body=[[round(x,1),round(y,1)] for x,y in body], headstock=[[round(x,1),round(y,1)] for x,y in Hs],
  tuners=dict(x0=round(P[0,0],1),y=round(P[0,1],1),pitch=round(pitch,2),dy=round(dy,2)),
  nutCentreY=round(cNut,1),heelX=round(neckL[0],1),heelCentreY=round(heelC+(neckL[0]-166)*slope,1),
  fit=dict(scale_mm_per_unit=round(s,3),rotation_deg=round(np.degrees(th),2),translate_mm=[round(tx,1),round(ty,1)]))
json.dump(out,open('gen.json','w'))
print({k:v for k,v in out.items() if k not in('body','headstock')})
