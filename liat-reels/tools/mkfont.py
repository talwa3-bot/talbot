import sys
from fontTools.ttLib import TTFont
from fontTools.merge import Merger
d=sys.argv[1]; out=sys.argv[2]
for fam in ["rubik","heebo"]:
  for w in ["800","900"]:
    paths=[]
    for sub in ["hebrew","latin"]:
      f=TTFont(f"{d}/fontsource-{fam}-5.1.0/package/files/{fam}-{sub}-{w}-normal.woff2"); f.flavor=None
      p=f"{out}/tmp-{fam}-{sub}-{w}.ttf"; f.save(p); paths.append(p)
    m=Merger().merge(paths)
    name=f"{fam.capitalize()} {w}"
    for r in m["name"].names:
      if r.nameID in (1,4,16): r.string=name
      if r.nameID==6: r.string=name.replace(" ","")
      if r.nameID in (2,17): r.string="Regular"
    m.save(f"{out}/{fam}-{w}.ttf")
