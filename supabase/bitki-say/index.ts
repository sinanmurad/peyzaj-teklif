// supabase/functions/bitki-say/index.ts
//
// Teklif uygulaması için: gönderilen bahçe/konsept görselindeki bitkileri ve
// yaklaşık adetlerini sayar (Gemini, onizleme-ai ile aynı analiz modeli).
// Görsel kaydedilmez, Telegram'a gitmez, sadece JSON döner.
//
// GÜVENLİK: Uygulama herkese açık olduğu için her istekte "x-teklif-anahtar"
// başlığı TEKLIF_ANAHTAR secret'ı ile eşleşmeli; yoksa Gemini çağrılmaz.
//
// Secret'lar: GEMINI_API_KEY (zaten var), TEKLIF_ANAHTAR (yeni)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-teklif-anahtar',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MODEL = 'gemini-3.1-flash-lite-image';
const MAX_BASE64 = 8 * 1024 * 1024; // ~6MB görsel

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const PROMPT = `Bu bir bahçe/peyzaj görseli (gerçek fotoğraf ya da tasarım konsepti).
Görseldeki BİTKİLERİ türüne göre grupla ve her grubun yaklaşık adedini say.
Kurallar:
- Bitki adını Türkçe, fidanlıkta aranacak yaygın adıyla yaz (örn. "şimşir", "mazı", "lavanta", "zeytin ağacı", "ligustrum", "ortanca").
- "tur" alanı şunlardan biri olsun: "ağaç", "çit", "çalı", "yer örtücü", "çiçek", "palmiye".
- Çit gibi sıra halindeki bitkilerde tek tek bitki sayısını tahmin et (genelde metreye 2-3 bitki).
- Adetler tam sayı olsun. Emin olmadığın şeyi uydurma; görmediğin bitkiyi yazma.
- Bitki olmayan öğeleri (çakıl, taş yol, fıskiye, pergola, çim alan vb.) "diger" listesine kısa yaz. Çim alanı varsa "diger"e "çim alan" olarak ekle.
Sadece şu JSON'u döndür:
{"bitkiler":[{"ad":"şimşir","adet":40,"tur":"çit"}],"diger":["çakıl yol"]}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return jsonRes({ error: 'Sadece POST' }, 405);

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  const ANAHTAR = Deno.env.get('TEKLIF_ANAHTAR');
  if (!GEMINI_API_KEY || !ANAHTAR) return jsonRes({ error: 'Sunucu ayarı eksik (GEMINI_API_KEY / TEKLIF_ANAHTAR)' }, 500);
  if (req.headers.get('x-teklif-anahtar') !== ANAHTAR) return jsonRes({ error: 'Anahtar hatalı' }, 401);

  let gorsel = '', mime = 'image/jpeg', not = '';
  try {
    const b = await req.json();
    gorsel = String(b?.gorsel || '');
    if (b?.mime) mime = String(b.mime);
    if (b?.not) not = String(b.not).slice(0, 300);
  } catch { return jsonRes({ error: 'Geçersiz JSON' }, 400); }
  if (!gorsel || gorsel.length > MAX_BASE64) return jsonRes({ error: 'Görsel yok ya da çok büyük' }, 400);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: PROMPT + (not ? `\nEk bilgi: ${not}` : '') }, { inline_data: { mime_type: mime, data: gorsel } }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  };
  for (let deneme = 0; deneme < 2; deneme++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) {
        const err = await res.text();
        if ((res.status === 429 || res.status >= 500) && deneme === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        return jsonRes({ error: 'AI hatası', detay: err.slice(0, 300) }, 502);
      }
      const j = await res.json();
      const txt = j.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === 'string')?.text || '';
      let veri: any;
      try { veri = JSON.parse(txt.replace(/^```(json)?|```$/g, '').trim()); } catch { return jsonRes({ error: 'AI cevabı okunamadı', ham: txt.slice(0, 500) }, 502); }
      const bitkiler = (Array.isArray(veri?.bitkiler) ? veri.bitkiler : [])
        .map((x: any) => ({ ad: String(x?.ad || '').slice(0, 80), adet: Math.max(1, Math.round(Number(x?.adet) || 0)), tur: String(x?.tur || '') }))
        .filter((x: any) => x.ad && x.adet > 0);
      const diger = (Array.isArray(veri?.diger) ? veri.diger : []).map((x: any) => String(x).slice(0, 60)).slice(0, 20);
      return jsonRes({ basarili: true, bitkiler, diger });
    } catch (e) {
      if (deneme === 0) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      return jsonRes({ error: e instanceof Error && e.name === 'AbortError' ? 'AI zaman aşımı' : String(e) }, 504);
    }
  }
  return jsonRes({ error: 'Beklenmeyen hata' }, 500);
});
