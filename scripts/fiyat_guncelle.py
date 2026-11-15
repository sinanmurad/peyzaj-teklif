#!/usr/bin/env python3
"""Tedarikçi fiyatlarını çekip fiyatlar.json'a yazar.
enfidan.com (WooCommerce Store API), Canlı Bahçe (ürün sayfası JSON-LD),
Usta Peyzaj (ürün sayfası HTML). Bir site/ürün okunamazsa eski değer korunur."""
import json, re, time, html, datetime, urllib.request, os, sys

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CIKTI = os.path.join(KOK, 'fiyatlar.json')
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
      'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/json,application/xhtml+xml,*/*;q=0.8',
      'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Upgrade-Insecure-Requests': '1'}

def getir(url, tekrar=2):
    for d in range(tekrar):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read().decode('utf-8', 'replace'), r.headers
        except Exception as e:
            hata = e; time.sleep(2 + d * 3)
    raise hata

def enfidan():
    out, sayfa, toplam = {}, 1, 1
    while sayfa <= toplam:
        txt, h = getir(f'https://enfidan.com/wp-json/wc/store/v1/products?per_page=100&page={sayfa}')
        toplam = int(h.get('X-WP-TotalPages') or 1)
        for p in json.loads(txt):
            pr = p.get('prices') or {}
            try:
                f = int(pr['price']) / 10 ** int(pr.get('currency_minor_unit', 2))
            except Exception:
                continue
            if f > 0:
                out[html.unescape(p['name']).strip()] = [round(f), 1 if p.get('is_in_stock') else 0]
        sayfa += 1; time.sleep(1)
    return out

def canli(url):
    txt, _ = getir(url)
    for blok in re.findall(r'<script type="application/ld\+json">(.*?)</script>', txt, re.S):
        try:
            j = json.loads(blok, strict=False)
        except Exception:
            continue
        o = j.get('offers') if isinstance(j, dict) else None
        if isinstance(o, list): o = o[0] if o else None
        if o and o.get('price'):
            return [round(float(o['price'])), 0 if 'OutOfStock' in str(o.get('availability', '')) else 1]
    return None

def usta(url):
    txt, _ = getir(url)
    m = re.search(r'class="fiyat-son[^"]*">\s*([\d.]+(?:,\d+)?)\s*TL', txt)
    if not m: return None
    f = float(m.group(1).replace('.', '').replace(',', '.'))
    stok = 0 if re.search(r'(Tükendi|Stokta yok)', txt, re.I) else 1
    return [round(f), stok]

def main():
    eski = {}
    if os.path.exists(CIKTI):
        eski = json.load(open(CIKTI, encoding='utf-8'))
    h = open(os.path.join(KOK, 'index.html'), encoding='utf-8').read()
    extra = json.loads(re.search(r'const EXTRA=(\[.*?\]);\n', h, re.S).group(1))
    yeni = {'tarih': datetime.date.today().strftime('%d.%m.%Y'), 'firmalar': {}}
    rapor = []

    sadece = os.environ.get('SADECE', '')
    try:
        if sadece and sadece != 'enfidan': raise RuntimeError('atlandı')
        print('enfidan.com okunuyor', flush=True)
        e = enfidan(); yeni['firmalar']['enfidan.com'] = e; rapor.append(f'enfidan.com: {len(e)} ürün')
    except Exception as ex:
        yeni['firmalar']['enfidan.com'] = eski.get('firmalar', {}).get('enfidan.com', {}); rapor.append(f'enfidan.com: HATA {ex}, eski değerler korundu')

    for firma, fn in (('Canlı Bahçe', canli), ('Usta Peyzaj', usta)):
        onceki = eski.get('firmalar', {}).get(firma, {})
        if sadece and sadece != 'diger':
            yeni['firmalar'][firma] = onceki; continue
        d, ok, hata, ardisik = {}, 0, 0, 0
        L = [x for x in extra if x['firma'] == firma and x.get('img')]
        print(f'{firma}: {len(L)} ürün okunuyor', flush=True)
        for n, it in enumerate(L, 1):
            u = it['img']
            if ardisik >= 5:  # site erişilemiyor: kalanlar için eski değer
                if u in onceki: d[u] = onceki[u]
                hata += 1; continue
            try:
                r = fn(u); ardisik = 0
            except Exception as ex:
                r = None; ardisik += 1
                print(f'  hata: {u} {ex}', flush=True)
            if n % 50 == 0: print(f'  {n}/{len(L)}', flush=True)
            if r and r[0] > 0:
                d[u] = r; ok += 1
            else:
                hata += 1
                if u in onceki: d[u] = onceki[u]
            time.sleep(0.4)
        yeni['firmalar'][firma] = d; rapor.append(f'{firma}: {ok} güncellendi, {hata} okunamadı')

    json.dump(yeni, open(CIKTI, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('\n'.join(rapor))

if __name__ == '__main__':
    main()
