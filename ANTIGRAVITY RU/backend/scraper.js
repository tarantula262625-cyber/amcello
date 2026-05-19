const axios = require('axios');

// 🔑 Sənin rəsmi bütöv API Key-in
const API_TOKEN = 'fapi_GuNidCOBna4eHrRHmCrTLYnYh8A7F6cf'; 

async function scrapeBet365Opening(year, month, day) {
  const formattedMonth = String(month).padStart(2, '0');
  const formattedDay = String(day).padStart(2, '0');
  const targetDate = `${year}-${formattedMonth}-${formattedDay}`;

  const apiHeaders = {
    'Authorization': `Bearer ${API_TOKEN.trim()}`,
    'Content-Type': 'application/json'
  };

  try {
    console.log(`[Rəsmi API] Matç siyahısı istənilir: ${targetDate}`);
    
    // 1. Günün matçlarını çəkirik
    const matchesResponse = await axios.get('https://api.thestatsapi.com/api/football/matches', {
      params: {
        date_from: targetDate,
        date_to: targetDate
      },
      headers: apiHeaders,
      timeout: 15000
    });

    const matchesData = matchesResponse.data && matchesResponse.data.data ? matchesResponse.data.data : [];
    console.log(`[Rəsmi API] Serverdən ${matchesData.length} oyun tapıldı. Adlar və əmsallar sökülür...`);

    const finalMatches = [];

    for (const match of matchesData) {
      const matchId = match.id;
      let open1 = "—", openX = "—", open2 = "—";
      let curr1 = "—", currX = "—", curr2 = "—";

      // Sənəddə yazıldığı kimi mütləq odds_available yoxlanılır
      if (match.odds_available) {
        try {
          const oddsResponse = await axios.get(`https://api.thestatsapi.com/api/football/matches/${matchId}/odds`, {
            headers: apiHeaders
          });
          
          const bookmakers = oddsResponse.data && oddsResponse.data.data && oddsResponse.data.data.bookmakers ? oddsResponse.data.data.bookmakers : [];
          const b365 = bookmakers.find(b => b.bookmaker === 'Bet365');
          
          if (b365 && b365.markets && b365.markets.match_odds) {
            const odds1X2 = b365.markets.match_odds;
            
            // Sənəddəki dəqiq sahələr: opening və last_seen
            open1 = odds1X2.home?.opening || "—";
            openX = odds1X2.draw?.opening || "—";
            open2 = odds1X2.away?.opening || "—";

            curr1 = odds1X2.home?.last_seen || open1;
            currX = odds1X2.draw?.last_seen || openX;
            curr2 = odds1X2.away?.last_seen || open2;
          }
        } catch (oddsErr) {
          // Xəta olanda dövr qırılmasın
        }
      }

      // 2. Hesab obyektini sənədə uyğun parçalayırıq (full_time daxilindən)
      let rəsmiHesab = "0:0";
      if (match.score) {
        if (match.score.full_time) {
          rəsmiHesab = `${match.score.full_time.home ?? 0}:${match.score.full_time.away ?? 0}`;
        } else if (typeof match.score === 'object') {
          rəsmiHesab = `${match.score.home ?? 0}:${match.score.away ?? 0}`;
        } else {
          rəsmiHesab = String(match.score);
        }
      }

      // 3. KOMANDA ADLARINI SÖKÜRÜK
      // Sənədə əsasən bəzən obyekt daxilində 'name' gəlir, bəzən birbaşa string olur
      let evSahibiAdı = "Ev Sahibi";
      let qonaqKomandaAdı = "Qonaq Komanda";

      if (match.home_team) {
        evSahibiAdı = typeof match.home_team === 'object' ? (match.home_team.name || "Ev Sahibi") : match.home_team;
      }
      if (match.away_team) {
        qonaqKomandaAdı = typeof match.away_team === 'object' ? (match.away_team.name || "Qonaq Komanda") : match.away_team;
      }

      // 4. LİQA ADINI SIĞORTALAYIRIQ (competition_name yoxdursa competition_id-ni təmizləyirik)
      let liqaAdı = match.competition_name || match.competition_id || "Futbol Liqası";
      if (liqaAdı && String(liqaAdı).startsWith('comp_')) {
        // Əgər sadəcə ID gəlibsə, onu ekranda qəşəng göstərək
        liqaAdı = "League ID: " + String(liqaAdı).replace('comp_', '');
      }

      // Əgər API hansısa səbəbdən adları tam verməyibsə və matç ID-si əlimizdədirsə, 
      // sənin frontend ekranında boşluq qalmasın deyə ID formatını adın yanına sığortalayırıq
      if (evSahibiAdı === "Ev Sahibi" && matchId) {
        evSahibiAdı = `Team (${matchId.replace('mt_', '')})`;
      }

      finalMatches.push({
        eventId: matchId,
        homeTeam: String(evSahibiAdı),
        awayTeam: String(qonaqKomandaAdı),
        league: String(liqaAdı),
        score: String(rəsmiHesab), 
        matchTime: match.status === 'finished' ? 'Fin' : (match.status === 'live' ? 'Live' : 'Scheduled'),
        bet365: {
          open1: String(open1), openX: String(openX), open2: String(open2),
          curr1: String(curr1), currX: String(currX), curr2: String(curr2)
        }
      });
    }

    console.log(`[Uğurlu] Toplam ${finalMatches.length} matç rəsmi məlumat modeli ilə frontend-ə ötürüldü.`);
    return { fromCache: false, matches: finalMatches };

  } catch (error) {
    console.error("TheStatsAPI xətası:", error.message);
    return { fromCache: false, matches: [] };
  }
}

module.exports = { scrapeBet365Opening };