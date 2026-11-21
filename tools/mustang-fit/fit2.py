import numpy as np, json
from scipy.optimize import least_squares
from scipy.spatial import cKDTree
B=np.load("body_in.npy")[::6]
# densify
d=json.load(open('/Users/alejandrodeleon/Documents/NewMedia_Master/digitalFabrication/midiguitar/reins-guitar/pickguard/v2/web/body_outline.json'))
seg={s['name']:np.array(s['points']) for s in d['segments']}
tr=seg['treble_edge_and_cutaway']; tr=tr[~((tr[:,1]>88))]
print('treble pts',len(tr), tr[-3:])
T=np.vstack([tr,seg['bass_horn_lower_edge']])
w=np.r_[np.ones(len(tr))/3.0, np.ones(5)*3/4.0]
def xf(p, th, sx, sy, tx, ty):
    c,s=np.cos(th),np.sin(th)
    q=p*np.array([sx,sy]); return np.c_[c*q[:,0]-s*q[:,1]+tx, s*q[:,0]+c*q[:,1]+ty]
def res(params, mode):
    if mode=='sim': th,s,tx,ty=params; sx=sy=s
    elif mode=='fixed': th,tx,ty=params; sx=sy=25.4
    else: th,sx,sy,tx,ty=params
    M=xf(B,th,sx,sy,tx,ty); tree=cKDTree(M)
    dd,_=tree.query(T); return dd*w
# initial: model x -> frame x, y -> y. model bass horn tip (-1.1,10.78) ~ frame (245,200); butt...
best={}
for mode,p0 in [('fixed',[0,0,0]),('sim',[0,25.4,0,0]),('aff',[0,25.4,25.4,0,0])]:
    bestc=None
    for th0 in np.radians([-4,0,4]):
      for s0 in [22,25.4]:
        for dx in [-20,0,20]:
         for dy in [-20,0,20]:
            # translation guess: map model treble horn tip region
            tx0=245-(-1.1)*s0+dx; ty0=200-10.78*s0+dy
            if mode=='fixed': p=[th0,245+1.1*25.4+dx,200-10.78*25.4+dy]
            elif mode=='sim': p=[th0,s0,tx0,ty0]
            else: p=[th0,s0,s0,tx0,ty0]
            r=least_squares(res,p,args=(mode,),loss='soft_l1',f_scale=1.0)
            c=np.sqrt(np.mean((r.fun)**2))
            if bestc is None or c<bestc[0]: bestc=(c,r.x)
    r=bestc[1]; dd=res(r,mode)/w
    print(mode, 'params', np.round(r,4), 'deg', round(np.degrees(r[0]),2), 'rms mm', round(float(np.sqrt(np.mean(dd**2))),2), 'max', round(float(dd.max()),2))
    best[mode]=r.tolist()
json.dump(best,open('fit2.json','w'))
