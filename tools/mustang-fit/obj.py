import numpy as np, sys, pickle
fn=sys.argv[1]
V=[];groups={};cur=None
for line in open(fn,errors='ignore'):
    if line.startswith('v '):
        V.append([float(t) for t in line.split()[1:4]])
    elif line.startswith('g '):
        cur=line.split(None,1)[1].strip(); groups.setdefault(cur,[])
    elif line.startswith('f '):
        idx=[int(t.split('/')[0]) for t in line.split()[1:]]
        groups[cur].append(idx)
V=np.array(V);print(len(V),V.min(0),V.max(0))
out={}
for g,F in groups.items():
    if not F: continue
    ids=np.array(sorted({abs(i)-1 for f in F for i in f}))
    P=V[ids];ext=P.max(0)-P.min(0)
    out[g]=(F)
    print(g,len(F),np.round(P.min(0),2),np.round(ext,2))
pickle.dump((V,groups),open(sys.argv[2],'wb'))
