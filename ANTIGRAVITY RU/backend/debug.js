// Bu faylı backend qovluğuna qoy və çalışdır:
// node debug.js

const axios = require('axios');

const API_TOKEN = 'fapi_GuNidCOBna4eHrRHmCrTLYnYh8A7F6cf';
const headers = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Content-Type': 'application/json'
};

async function debug() {
  // 1. Matç siyahısı - tam cavabı gör
  console.log('=== MATÇ SİYAHISI ===');
  const r = await axios.get('https://api.thestatsapi.com/api/football/matches', {
    params: { date_from: '2026-05-18', date_to: '2026-05-18' },
    headers,
    timeout: 15000
  });

  const matches = r.data?.data || [];
  console.log('Matç sayı:', matches.length);
  console.log('\nİLK MATÇIN TAM CAVABI:');
  console.log(JSON.stringify(matches[0], null, 2));

  // 2. Odds endpoint - ilk matç üçün
  if (matches[0]) {
    const matchId = matches[0].id;
    console.log('\n=== ODDS CAVABI (matchId:', matchId, ') ===');
    try {
      const o = await axios.get(`https://api.thestatsapi.com/api/football/matches/${matchId}/odds`, { headers });
      console.log(JSON.stringify(o.data, null, 2));
    } catch(e) {
      console.log('Odds xətası:', e.message);
    }
  }
}

debug().catch(console.error);
