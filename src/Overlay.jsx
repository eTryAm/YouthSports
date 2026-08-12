import { useState, useEffect, useRef } from "react";
import { socket } from "./socket.js";
import "./Overlay.css";

function getOverStr(overHistory, currentOverBalls) {
  if (!overHistory || !currentOverBalls) return "0.0";
  const legal = currentOverBalls.filter(b => b !== 'Wd' && b !== 'Nb').length;
  return `${overHistory.length}.${legal}`;
}

export default function Overlay() {
  const [match, setMatch] = useState(null);
  const [animation, setAnimation] = useState(null); // { type: 'four', id: 123 }
  const [scale, setScale] = useState(1);
  const prevDeliveriesRef = useRef(0);

  useEffect(() => {
    // We only need to add a body class when this component is mounted to ensure transparent bg
    document.body.classList.add('obs-overlay-mode');
    
    // Responsive scaling for non-OBS displays (e.g. mobile)
    const handleResize = () => {
      const scaleX = window.innerWidth / 1920;
      const scaleY = window.innerHeight / 1080;
      setScale(Math.min(scaleX, scaleY, 1)); // scale down to fit, but don't scale up beyond 1x
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      document.body.classList.remove('obs-overlay-mode');
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    const onMatchState = (data) => {
      setMatch(data);

      const currentDeliveries = data ? (data.overHistory?.length || 0) * 6 + (data.currentOverBalls?.length || 0) : 0;

      // Trigger animations based on last ball if a NEW ball was bowled
      if (data && data.status === 'live' && data.lastBall && currentDeliveries > prevDeliveriesRef.current) {
        const ball = data.lastBall;
        if (ball === '4') {
          triggerAnimation('four', currentDeliveries);
        } else if (ball === '6') {
          triggerAnimation('six', currentDeliveries);
        } else if (ball === 'W') {
          triggerAnimation('wicket', currentDeliveries);
        }
      }
      prevDeliveriesRef.current = currentDeliveries;
    };

    socket.on("matchState", onMatchState);
    if (socket.connected) socket.emit("requestState");

    return () => {
      socket.off("matchState", onMatchState);
    };
  }, []);

  const triggerAnimation = (type, id) => {
    setAnimation({ type, id });
    setTimeout(() => {
      setAnimation(prev => (prev && prev.id === id ? null : prev));
    }, 4000); // Banner stays for 4 seconds
  };

  if (!match) return <div className="overlay-transparent"></div>;

  const containerStyle = { transform: `scale(${scale})` };

  // Not started or reset state - show nothing or minimal graphic
  if (match.status === "not_started" || match.status === "finished") {
    return (
      <div className="overlay-wrapper">
        <div className="overlay-container" style={containerStyle}>
          {match.status === "finished" && match.result && (
            <div className="overlay-banner result-banner slide-in">
              <div className="banner-title">MATCH RESULT</div>
              <div className="banner-value">{match.result}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Innings break
  if (match.status === "inning_break") {
    return (
      <div className="overlay-wrapper">
        <div className="overlay-container" style={containerStyle}>
          <div className="overlay-banner break-banner slide-in">
            <div className="banner-title">INNINGS BREAK</div>
            <div className="banner-value">
              {match.team1Name} {match.inning1?.totalRuns}/{match.inning1?.wickets}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Live Match State ---
  const isInn2 = match.currentInning === 2;
  const battingTeam = isInn2 ? match.team2Name : match.team1Name;
  const bowlingTeam = isInn2 ? match.team1Name : match.team2Name;
  
  const oversStr = getOverStr(match.overHistory, match.currentOverBalls);
  
  // Calculate Run Rate
  const totalLegalBalls = match.overHistory.length * 6 + match.currentOverBalls.filter(b => b !== 'Wd' && b !== 'Nb').length;
  const crr = totalLegalBalls > 0 ? ((match.totalRuns / totalLegalBalls) * 6).toFixed(2) : "0.00";

  // Identify players
  const striker = match.players.find(p => p.id === match.strikerId);
  const nonStriker = match.players.find(p => p.id === match.nonStrikerId);
  const currentBowler = match.bowlers.find(b => b.id === match.currentBowlerId);

  // Recent Balls (last 6 legal/extras)
  const recentBalls = match.currentOverBalls.slice(-6);

  // Partnership calculation (Runs since last wicket)
  // We can approximate by taking totalRuns - (score at last fall of wicket)
  let partnershipRuns = match.totalRuns;
  if (match.fallOfWickets && match.fallOfWickets.length > 0) {
    const lastWicket = match.fallOfWickets[match.fallOfWickets.length - 1];
    partnershipRuns = match.totalRuns - lastWicket.score;
  }

  return (
    <div className="overlay-wrapper">
      <div className="overlay-container" style={containerStyle}>
        {/* Top Left: Tournament & LIVE */}
        <div className="ov-top-left">
        <div className="ov-tournament-name">CHAMPIONS CUP 2026</div>
        <div className="ov-live-indicator">
          <span className="ov-live-dot"></span> LIVE
        </div>
      </div>

      {/* Top Right: CRR & Sponsor */}
      <div className="ov-top-right">
        <div className="ov-sponsor-area">
          <span className="ov-sponsor-text">SPONSORED BY</span>
          <div className="ov-sponsor-placeholder">YOUR LOGO</div>
        </div>
      </div>

      {/* Animation Banners (4, 6, Wicket) */}
      {animation && (
        <div key={animation.id} className={`ov-event-banner slide-in-bottom type-${animation.type}`}>
          {animation.type === 'four' && <span className="ev-text">FOUR RUNS</span>}
          {animation.type === 'six' && <span className="ev-text">SIX RUNS!</span>}
          {animation.type === 'wicket' && <span className="ev-text">WICKET!</span>}
        </div>
      )}

      {/* Bottom Score Bug */}
      <div className="ov-bottom-bar">
        
        {/* Main Score Area */}
        <div className="ov-main-score">
          <div className="ov-team-name">{battingTeam}</div>
          <div className="ov-score-runs">
            <span className="runs">{match.totalRuns}</span>
            <span className="slash">-</span>
            <span className="wickets">{match.wickets}</span>
          </div>
          <div className="ov-overs">
            <span className="ov-overs-val">{oversStr}</span>
            <span className="ov-overs-lbl">OVERS</span>
          </div>
          <div className="ov-crr">
            CRR: {crr}
          </div>
          {isInn2 && match.target && (
            <div className="ov-target-box">
              <div className="target-lbl">TARGET {match.target}</div>
              <div className="req-lbl">NEED {match.target - match.totalRuns} OFF {(match.maxOvers * 6) - totalLegalBalls}</div>
            </div>
          )}
        </div>

        {/* Player Stats Area */}
        <div className="ov-players-area">
          {/* Batsmen */}
          <div className="ov-batsmen">
            {striker && (
              <div className="ov-player-row active-striker">
                <span className="p-name">{striker.name} <span className="bat-icon">🏏</span></span>
                <span className="p-runs">{striker.runs}</span>
                <span className="p-balls">({striker.balls})</span>
              </div>
            )}
            {nonStriker && (
              <div className="ov-player-row">
                <span className="p-name">{nonStriker.name}</span>
                <span className="p-runs">{nonStriker.runs}</span>
                <span className="p-balls">({nonStriker.balls})</span>
              </div>
            )}
            <div className="ov-partnership">
              P'SHIP: <strong>{partnershipRuns}</strong>
            </div>
          </div>

          {/* Bowler & Recent */}
          <div className="ov-bowler-section">
            {currentBowler ? (
              <div className="ov-bowler-row">
                <span className="p-name">{currentBowler.name}</span>
                <span className="p-stat">{currentBowler.wickets}-{currentBowler.runsConceded}</span>
                <span className="p-overs">({Math.floor(currentBowler.ballsBowled / 6)}.{currentBowler.ballsBowled % 6})</span>
              </div>
            ) : (
              <div className="ov-bowler-row">
                <span className="p-name">Waiting for bowler...</span>
              </div>
            )}
            
            <div className="ov-recent-balls">
              <span className="recent-lbl">THIS OVER:</span>
              <div className="recent-balls-list">
                {recentBalls.length > 0 ? (
                  recentBalls.map((b, i) => (
                    <span key={i} className={`ov-ball b-${b}`}>{b}</span>
                  ))
                ) : (
                  <span className="ov-ball empty">-</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
