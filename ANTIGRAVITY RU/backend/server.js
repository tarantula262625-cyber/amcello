// ═══════════════════════════════════════════════════════════════════════════════
// BetOdds Analyzer — Backend Server (TheStatsAPI & Railway Production Versiyası)
// ═══════════════════════════════════════════════════════════════════════════════

const express   = require('express');
const axios     = require('axios');
const NodeCache = require('node-cache');
const cors      = require('cors');

const app   = express();
const cache = new NodeCache({ stdTTL: 3600 });

app.use(cors());
app.use(express.json());

// 🔑 API Açarı — Lokalda sənin kodun, Railway-də isə Variables hissəsindən oxunacaq
const API_TOKEN = process.env.THESTATSAPI_KEY || 'fapi_GuNidCOBna4eHrRHmCrTLYnYh8A7F6cf';
const API_BASE  = 'https://api.thestatsapi.com/api/football';
const HEADERS   = { 'Authorization': `Bearer ${API_TOKEN.trim()}`, 'Content-Type': 'application/json' };

// Competition ID → Ad xəritəsi (Liqa adlarını keşləmək üçün)
const compCache = {};

// ── Endpoints ─────────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/odds', async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date lazımdır: YYYY-MM-DD' });

  const cached = cache.get(`odds_${date}`);
  if (cached) return res.json({ ...cached, fromCache: true });

  try {
    const result = await fetchAll(date);
    cache.set(`odds_${date}`, result);
    res.json({ ...result, fromCache: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/refresh', async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date lazımdır' });
  cache.del(`odds_${date}`);
  try {
    const result = await fetchAll(date);
    cache.set(`odds_${date}`, result);
    res.json({ ...result, fromCache: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANA DATA YIĞMA FUNKSİYASI
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchAll(date) {
  console.log(`\n[START SORĞU] Tarix üçün datalar çəkilir: ${date}`);

  // 1. Günün rəsmi matç siyahısını alırıq
  const matchRes = await axios.get(`${API_BASE}/matches`, {
    params: { date_from: date, date_to: date },
    headers: HEADERS,
    timeout: 20000
  });

  const matches = matchRes.data?.data || [];
  console.log(`[INFO] Serverdən Toplam ${matches.length} matç tapıldı`);

  if (!matches.length) return { date, matches: [], fetchedAt: new Date().toISOString() };

  // 2. Unikal liqa ID-lərini toplayıb adlarını arxa planda çəkirik
  const compIds = [...new Set(matches.map(m => m.competition_id).filter(Boolean))];
  await fetchCompetitionNames(compIds);

  // 3. Hər matç üçün əmsalları (odds) 5-lik paketlərlə (batch) yığırıq
  const results = [];
  const BATCH = 5;
  for (let i = 0; i < matches.length; i += BATCH) {
    const batch = matches.slice(i, i + BATCH);
    const batchRes = await Promise.all(batch.map(m => processMatch(m)));
    results.push(...batchRes);
    console.log(`  [${Math.min(i + BATCH, matches.length)}/${matches.length}] matç uğurla emal olundu`);
    if (i + BATCH < matches.length) await sleep(200);
  }

  return { date, matches: results, fetchedAt: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BİR MATÇI DETALLI PARÇALA VƏ FRONTENDƏ UYĞUNLAŞDIR
// ═══════════════════════════════════════════════════════════════════════════════
async function processMatch(match) {
  // 🔥 SƏNƏDƏ UYĞUN: Komanda adlarını tam string formatına salırıq
  let homeTeam = 'Ev Sahibi';
  let awayTeam = 'Qonaq Komanda';

  if (match.home_team) {
    homeTeam = typeof match.home_team === 'object' ? (match.home_team.name || "Ev Sahibi") : match.home_team;
  }
  if (match.away_team) {
    awayTeam = typeof match.away_team === 'object' ? (match.away_team.name || "Qonaq Komanda") : match.away_team;
  }

  // 🔥 SƏNƏDƏ UYĞUN: Əgər hansısa matçın adı yoxdursa, ID-dən ad düzəldirik ki ekranda ID çıxmasın
  if (homeTeam === "Ev Sahibi" && match.id) {
    homeTeam = `Team (${match.id.replace('mt_', '')})`;
  }

  // Liqa adı — Keşlənmiş adlardan tapırıq, yoxdursa ID formatını qəşəngləşdiririk
  let league = compCache[match.competition_id] || match.competition_id || 'Futbol Liqası';
  if (league && String(league).startsWith('comp_')) {
    league = "League ID: " + String(league).replace('comp_', '');
  }

  // 🔥 SƏNƏDƏ UYĞUN: Hesab obyektini full_time və ya obyekt daxilindən təmiz sökürük
  let score = "0:0";
  if (match.score) {
    if (match.score.full_time) {
      score = `${match.score.full_time.home ?? 0}:${match.score.full_time.away ?? 0}`;
    } else if (typeof match.score === 'object' && match.score.home !== undefined) {
      score = `${match.score.home ?? 0}:${match.score.away ?? 0}`;
    } else {
      score = String(match.score);
    }
  }

  // Matçın statusunu format etmək
  const matchTime = formatStatus(match);

  // Əmsalları çək (Mütləq odds_available bayrağı yoxlanılır)
  let bet365 = null;
  if (match.odds_available) {
    bet365 = await fetchBet365(match.id);
  }

  return { matchId: match.id, homeTeam, awayTeam, league, score, matchTime, bet365 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BET365 ƏMSALLARINI ÇƏK
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchBet365(matchId) {
  try {
    const res = await axios.get(`${API_BASE}/matches/${matchId}/odds`, {
      headers: HEADERS,
      timeout: 15000
    });

    const bookmakers = res.data?.data?.bookmakers || [];
    const b365 = bookmakers.find(b => b.bookmaker === 'Bet365');
    if (!b365) return null;

    const mo = b365.markets?.match_odds;
    if (!mo) return null;

    return {
      open1: parseFloat(mo.home?.opening) || null,
      openX: parseFloat(mo.draw?.opening) || null,
      open2: parseFloat(mo.away?.opening) || null,
      curr1: parseFloat(mo.home?.last_seen) || null,
      currX: parseFloat(mo.draw?.last_seen) || null,
      curr2: parseFloat(mo.away?.last_seen) || null,
    };
  } catch (e) {
    return null; // Əmsal yoxdursa sistemi qırma, boş qaytar
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LİQA ADLARINI TOPLU OLARAQ ÇƏK
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchCompetitionNames(compIds) {
  const toFetch = compIds.filter(id => !compCache[id]);
  if (!toFetch.length) return;

  await Promise.all(toFetch.map(async (compId) => {
    try {
      const res = await axios.get(`${API_BASE}/competitions/${compId}`, {
        headers: HEADERS,
        timeout: 10000
      });
      const comp = res.data?.data || res.data;
      compCache[compId] = comp?.name || compId;
    } catch (e) {
      compCache[compId] = compId; 
    }
  }));
}

// ── Köməkçi Funksiyalar ───────────────────────────────────────────────────────
function formatStatus(match) {
  if (match.status === 'finished') {
    const d = new Date(match.utc_date);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} FT`;
  }
  if (match.status === 'live') return 'CANLI';
  if (match.utc_date) {
    const d = new Date(match.utc_date);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  return match.status || '';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── SERVERİ İŞƏ SALMA (Railway Üçün Dinamik Port) ─────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  BetOdds Production Server İşə Düşdü     ║');
  console.log(`║  Port: ${PORT}                             ║`);
  console.log('╚══════════════════════════════════════════╝');
});
