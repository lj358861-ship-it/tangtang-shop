import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from translations import DE_ES, PDF_NAMES, DESC, DEFAULT_DESC
FX = 84  # 1 CNY = 84 FCFA (rate used in the original site)
P = json.load(open(os.path.join(os.path.dirname(__file__), 'original_catalog.json')))
SZ = {'shoe': ['36','37','38','39','40','41','42','43','44','45'], 'cloth': ['S','M','L','XL','XXL'],
      'wig': ['12"','16"','20"','24"','28"'], 'phone': ['64GB','128GB','256GB'], 'hat': ['S/M','L/XL','ONE'], 'bag': ['ONE','S','M','L']}
def fcfa(cny): return int(round(cny * FX / 50.0) * 50)
def moq(cny): return 10 if cny < 30 else 3 if cny < 100 else 1
out = []
for n, p in enumerate(P):
    de, es = DE_ES[n]
    d = DESC.get(p['c'], DEFAULT_DESC)
    out.append(dict(
        sku=f"TT-{n+1:04d}", cat=p['c'], section=p['s'],
        name=dict(zh=p['zh'], fr=p['fr'], en=p['en'], de=de, es=es),
        desc=dict(zh=d[0], fr=d[1], en=d[2], de=d[3], es=d[4]),
        price=fcfa(p['p']), kg=p['kg'], discount=p['d'], sold=p['sold'], moq=moq(p['p']),
        images=[f"/img/p/s{i:03d}.jpg" for i in p['i']],
        variants=p.get('vn') or [], colors=p.get('cl') or {},
        sizes=p.get('sz') or SZ.get(p['c'], []), is_new=0, needs_price=0))
# ---- new products found in the WhatsApp PDF (prices are estimates: confirm in admin portal) ----
W = lambda *ids: [f"/img/p/w{i:03d}.jpg" for i in ids]
NEW = [
 ('nails','beauty','w',28,0.05,W(0,7,10,12,18,19,30,31,33),[]),
 ('scooter','bike','g',380,8,W(3,26),['Vert frais','Rose princesse']),
 ('purple','shoe','m',105,0.9,W(1,6),[]), ('navy','shoe','m',118,0.9,W(4),[]), ('white','shoe','m',99,0.9,W(17),[]),
 ('canvas','shoe','m',72,0.7,W(21),[]), ('greyskate','shoe','m',102,0.9,W(22),[]), ('navygum','shoe','m',108,0.9,W(23),[]),
 ('redskate','shoe','m',102,0.9,W(25),[]), ('blackgum','shoe','m',108,0.9,W(32),[]), ('bw','shoe','m',95,0.8,W(34),[]),
 ('cream','shoe','m',112,0.9,W(36),[]),
 ('jpolo','cloth','m',46,0.3,W(5,20),['Blanc','Noir']), ('kpolo','cloth','m',44,0.3,W(16,24),[]),
 ('dress','cloth','m',55,0.35,W(15),[]), ('clasp','cloth','m',62,0.35,W(29),[]), ('redset','cloth','m',88,0.6,W(14),[]),
 ('knittee','cloth','m',40,0.3,W(9),[]), ('redtee','cloth','m',30,0.25,W(38),[]), ('cardigan','cloth','m',92,0.6,W(8),[]),
 ('jacket','cloth','m',110,0.8,W(13),[]),
 ('blackbag','bag','w',70,0.6,W(2),[]), ('brownbag','bag','w',76,0.7,W(11),[]), ('brownbags','bag','w',82,0.7,W(28),[]),
 ('embossed','bag','w',86,0.7,W(39),[]), ('duffel','bag','m',60,0.9,W(35,37),[]),
 ('mugs','misc','g',85,6,W(27),[]),
]
for k, (key, cat, sec, cny, kg, imgs, vn) in enumerate(NEW):
    zh, fr, en, de, es = PDF_NAMES[key]
    d = DESC.get(cat, DEFAULT_DESC)
    n = len(out) + 1
    out.append(dict(sku=f"TT-{n:04d}", cat=cat, section=sec, name=dict(zh=zh, fr=fr, en=en, de=de, es=es),
        desc=dict(zh=d[0], fr=d[1], en=d[2], de=d[3], es=d[4]), price=fcfa(cny), kg=kg, discount=0, sold=0, moq=moq(cny),
        images=imgs, variants=vn, colors={}, sizes=SZ.get(cat, []), is_new=1, needs_price=1))
json.dump(out, open(os.path.join(os.path.dirname(__file__), '..', 'data', 'seed-products.json'), 'w'), ensure_ascii=False, indent=1)
print(len(out), 'products')
