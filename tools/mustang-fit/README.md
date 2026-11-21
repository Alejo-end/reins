# Mustang outline fit

These scripts made the body, neck and headstock in `tools/mustang.json`. Run them in order with the FreeCAD Python: `obj.py`, `sil.py`, `fit2.py`, `gen.py`. `cmp.py` draws the comparison images.

The source is the 3D model `digitalFabrication/squier/fender mustang.obj` (body group `Group_008`, headstock group `Group_052`). `fit2.py` fits it to the photo traces in `midiguitar/reins-guitar/pickguard/v2/web/body_outline.json` with one uniform scale, a turn and a shift.

The scripts were written in a scratch folder. If a path in them points there, change it before you run them.
